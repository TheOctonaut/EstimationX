import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Redis } from "@upstash/redis";
import { RedisStore } from "./store.ts";

function storeWithResponse(t: TestContext, result: unknown) {
  t.mock.method(globalThis, "fetch", async () => Response.json({ result }));
  return new RedisStore(new Redis({
    url: "https://redis.example.com",
    token: "test-token",
    automaticDeserialization: false,
    enableAutoPipelining: false,
    responseEncoding: false,
  }));
}

test("Redis hashes decode field/value pairs without parsing stored strings", async (t) => {
  const fields = {
    host: "host123",
    phase: "voting",
    round: "1",
    "p:host123": '{"name":"Host","tokenHash":"abc"}',
    "v:host123": "5",
  };
  const store = storeWithResponse(t, Object.entries(fields).flat());
  assert.deepEqual(await store.getAll("room:example"), fields);
});

test("missing Redis hashes return null", async (t) => {
  const store = storeWithResponse(t, []);
  assert.equal(await store.getAll("room:missing"), null);
});

test("malformed Redis hash responses fail explicitly", async (t) => {
  for (const result of [["host"], ["round", 1], { host: "host123" }]) {
    const store = storeWithResponse(t, result);
    await assert.rejects(store.getAll("room:example"), /Invalid Redis hash/);
    t.mock.restoreAll();
  }
});
