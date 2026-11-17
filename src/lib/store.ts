import { Redis } from "@upstash/redis";

/** Minimal hash store: each room is a single Redis hash so a poll costs one command. */
export interface HashStore {
  getAll(key: string): Promise<Record<string, string> | null>;
  set(key: string, fields: Record<string, string>, ttlSeconds: number): Promise<void>;
  remove(key: string, fields: string[]): Promise<void>;
  setIfAbsent(key: string, field: string, value: string, ttlSeconds: number): Promise<boolean>;
}

export class RedisStore implements HashStore {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async getAll(key: string) {
    // Disabling SDK deserialization also disables HGETALL's array-to-object conversion.
    const result: unknown = await this.redis.hgetall(key);
    if (!Array.isArray(result) || result.length % 2 !== 0) {
      throw new Error("Invalid Redis hash response");
    }
    const fields: Record<string, string> = {};
    for (let i = 0; i < result.length; i += 2) {
      const field = result[i];
      const value = result[i + 1];
      if (typeof field !== "string" || typeof value !== "string") {
        throw new Error("Invalid Redis hash field or value");
      }
      fields[field] = value;
    }
    return result.length ? fields : null;
  }

  async set(key: string, fields: Record<string, string>, ttlSeconds: number) {
    await this.redis.pipeline().hset(key, fields).expire(key, ttlSeconds).exec();
  }

  async remove(key: string, fields: string[]) {
    if (fields.length) await this.redis.hdel(key, ...fields);
  }

  async setIfAbsent(key: string, field: string, value: string, ttlSeconds: number) {
    const [inserted] = await this.redis.pipeline().hsetnx(key, field, value).expire(key, ttlSeconds).exec<[number, number]>();
    return inserted === 1;
  }
}

class MemoryStore implements HashStore {
  private data = new Map<string, { fields: Record<string, string>; expiresAt: number }>();

  async getAll(key: string) {
    const entry = this.data.get(key);
    if (!entry || entry.expiresAt < Date.now()) return null;
    return Object.keys(entry.fields).length ? { ...entry.fields } : null;
  }

  async set(key: string, fields: Record<string, string>, ttlSeconds: number) {
    const entry = this.data.get(key);
    const existing = entry && entry.expiresAt >= Date.now() ? entry.fields : {};
    this.data.set(key, { fields: { ...existing, ...fields }, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async remove(key: string, fields: string[]) {
    const entry = this.data.get(key);
    if (entry) for (const field of fields) delete entry.fields[field];
  }

  async setIfAbsent(key: string, field: string, value: string, ttlSeconds: number) {
    let entry = this.data.get(key);
    if (!entry || entry.expiresAt < Date.now()) {
      entry = { fields: {}, expiresAt: Date.now() + ttlSeconds * 1000 };
      this.data.set(key, entry);
    }
    if (Object.hasOwn(entry.fields, field)) return false;
    entry.fields[field] = value;
    entry.expiresAt = Date.now() + ttlSeconds * 1000;
    return true;
  }
}

const globalStore = globalThis as unknown as { __estimationxStore?: HashStore };

export function getStore(): HashStore {
  if (globalStore.__estimationxStore) return globalStore.__estimationxStore;

  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

  let store: HashStore;
  if (url && token) {
    store = new RedisStore(new Redis({ url, token, automaticDeserialization: false }));
  } else if (process.env.NODE_ENV !== "production" || process.env.ESTIMATIONX_MEMORY_STORE === "1") {
    store = new MemoryStore();
  } else {
    throw new Error(
      "No Redis configured. Add Upstash Redis to the Vercel project (sets KV_REST_API_URL / KV_REST_API_TOKEN).",
    );
  }
  globalStore.__estimationxStore = store;
  return store;
}
