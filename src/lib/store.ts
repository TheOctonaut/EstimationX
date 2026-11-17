import { Redis } from "@upstash/redis";

/** Minimal hash store: each room is a single Redis hash so a poll costs one command. */
export interface HashStore {
  getAll(key: string): Promise<Record<string, string> | null>;
  set(key: string, fields: Record<string, string>, ttlSeconds: number): Promise<void>;
  remove(key: string, fields: string[]): Promise<void>;
}

class RedisStore implements HashStore {
  constructor(private redis: Redis) {}

  async getAll(key: string) {
    const result = await this.redis.hgetall<Record<string, string>>(key);
    return result && Object.keys(result).length ? result : null;
  }

  async set(key: string, fields: Record<string, string>, ttlSeconds: number) {
    await this.redis.pipeline().hset(key, fields).expire(key, ttlSeconds).exec();
  }

  async remove(key: string, fields: string[]) {
    if (fields.length) await this.redis.hdel(key, ...fields);
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
    const existing = (await this.getAll(key)) ?? {};
    this.data.set(key, { fields: { ...existing, ...fields }, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async remove(key: string, fields: string[]) {
    const entry = this.data.get(key);
    if (entry) for (const field of fields) delete entry.fields[field];
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
