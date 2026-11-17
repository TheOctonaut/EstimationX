import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoom, getRoom, joinRoom, reset, reveal, startVoting, vote } from "./rooms.ts";

test("rounds wait for the host, use a shared 45-second default, and reset the timer", async () => {
  const host = await createRoom("Host");
  const guest = await joinRoom(host.roomId, "Guest", null);
  let room = await getRoom(host.roomId, host);
  assert.equal(room.phase, "waiting");
  assert.equal(room.voteEndsAt, null);
  await assert.rejects(vote(host.roomId, host, "5", 1), /not started/);
  await assert.rejects(reveal(host.roomId, host), /not started/);
  await assert.rejects(startVoting(host.roomId, guest), /Only the host/);
  for (const duration of [null, 0, -1, 1.5, 3601, "45"]) {
    await assert.rejects(startVoting(host.roomId, host, duration), /duration/);
  }
  const before = Date.now();
  room = await startVoting(host.roomId, host);
  assert.equal(room.phase, "voting");
  assert.ok(room.voteEndsAt !== null);
  assert.ok(room.voteEndsAt >= before + 45000 && room.voteEndsAt <= Date.now() + 45000);
  assert.equal((await getRoom(host.roomId, guest)).voteEndsAt, room.voteEndsAt);
  await assert.rejects(startVoting(host.roomId, host), /already started/);
  await vote(host.roomId, host, "5", 1);
  room = await vote(host.roomId, guest, "8", 1);
  assert.equal(room.phase, "revealed");
  assert.equal(room.summary?.average, 6.5);
  room = await vote(host.roomId, guest, "13", 1);
  assert.equal(room.summary?.average, 9);
  room = await reset(host.roomId, host);
  assert.equal(room.phase, "waiting");
  assert.equal(room.round, 2);
  assert.equal(room.voteEndsAt, null);
  assert.ok(room.participants.every((p) => !p.hasVoted));
});

test("timer expiry is advisory and does not prevent votes or manual reveal", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const host = await createRoom("Host");
  const guest = await joinRoom(host.roomId, "Guest", null);
  const started = await startVoting(host.roomId, host, 2);
  t.mock.timers.tick(3000);
  let room = await getRoom(host.roomId, guest);
  assert.equal(room.voteEndsAt, started.voteEndsAt);
  assert.equal(room.phase, "voting");
  room = await vote(host.roomId, guest, "21", 1);
  assert.equal(room.phase, "voting");
  await assert.rejects(vote(host.roomId, guest, "34", 1), /Invalid card/);
  room = await reveal(host.roomId, host);
  assert.equal(room.phase, "revealed");
  room = await vote(host.roomId, guest, "13", 1);
  assert.equal(room.summary?.average, 13);
});
