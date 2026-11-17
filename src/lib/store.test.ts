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

test("Redis set-if-absent reports whether an immutable round snapshot was inserted", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => Response.json([
    { result: requests++ === 0 ? 1 : 0 }, { result: 1 },
  ]));
  const store = new RedisStore(new Redis({
    url: "https://redis.example.com",
    token: "test-token",
    automaticDeserialization: false,
    enableAutoPipelining: false,
    responseEncoding: false,
  }));
  assert.equal(await store.setIfAbsent("room:example", "h:1", "first", 60), true);
  assert.equal(await store.setIfAbsent("room:example", "h:1", "second", 60), false);
});
