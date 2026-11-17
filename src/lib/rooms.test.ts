import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoom, finalizeRound, getRoom, joinRoom, leave, nameVote, renameParticipant, reset, reveal, startVoting, vote } from "./rooms.ts";

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

test("named vote history updates during discussion and persists final scores across rounds", async () => {
  const host = await createRoom("Host");
  const guest = await joinRoom(host.roomId, "Guest", null);
  await assert.rejects(nameVote(host.roomId, guest, "FS-1234"), /Only the host/);
  await assert.rejects(nameVote(host.roomId, host, "x".repeat(101)), /100 characters/);
  await assert.rejects(nameVote(host.roomId, host, null), /100 characters/);
  await nameVote(host.roomId, host, "  FS-1234  ");
  assert.equal((await getRoom(host.roomId, guest)).voteName, "FS-1234");
  await startVoting(host.roomId, host);
  await vote(host.roomId, host, "5", 1);
  assert.deepEqual((await getRoom(host.roomId, guest)).history, []);
  let room = await vote(host.roomId, guest, "8", 1);
  const timestamp = room.history[0].timestamp;
  assert.ok(timestamp > 0);
  assert.deepEqual(room.history[0], { round: 1, timestamp, name: "FS-1234", score: 8, average: 6.5 });
  room = await vote(host.roomId, guest, "21", 1);
  assert.equal(room.history[0].score, 13);
  assert.equal(room.history[0].average, 13);
  assert.equal(room.history[0].timestamp, timestamp);
  await reveal(host.roomId, host);
  assert.equal((await getRoom(host.roomId, host)).history[0].timestamp, timestamp);
  room = await reset(host.roomId, host);
  assert.equal(room.voteName, "");
  assert.equal(room.history[0].name, "FS-1234");
  assert.equal(room.history[0].score, 13);
  await startVoting(host.roomId, host);
  room = await reveal(host.roomId, host);
  assert.equal(room.history[0].round, 2);
  assert.equal(room.history[0].name, "");
  assert.equal(room.history[0].score, null);
  assert.equal(room.history[1].score, 13);
  await reset(host.roomId, host);
  room = await getRoom(host.roomId, guest);
  assert.equal(room.history.length, 2);
  assert.equal(room.history[1].timestamp, timestamp);
});

test("points compare the first pre-reveal vote with the final discussion result, only once", async () => {
  const host = await createRoom("Host");
  const guest = await joinRoom(host.roomId, "Guest", null);
  await startVoting(host.roomId, host);
  await vote(host.roomId, host, "3", 1);
  await vote(host.roomId, host, "5", 1);
  await vote(host.roomId, guest, "8", 1);
  const late = await joinRoom(host.roomId, "Late voter", null);
  await vote(host.roomId, guest, "3", 1);
  await vote(host.roomId, late, "3", 1);
  let room = await getRoom(host.roomId, host);
  assert.equal(room.summary?.nearest, 3);
  assert.ok(room.leaderboard.every((p) => p.points === 0));
  await assert.rejects(finalizeRound(host.roomId, guest, 1), /Only the host/);
  await Promise.all([
    finalizeRound(host.roomId, host, 1),
    finalizeRound(host.roomId, host, 1),
  ]);
  room = await getRoom(host.roomId, host);
  assert.equal(room.finalized, true);
  assert.equal(room.leaderboard.find((p) => p.participantId === host.participantId)?.points, 1);
  assert.equal(room.leaderboard.find((p) => p.participantId === guest.participantId)?.points, 0);
  assert.equal(room.leaderboard.find((p) => p.participantId === late.participantId)?.points, 0);
  await assert.rejects(vote(host.roomId, guest, "3", 1), /finalised/);
  room = await reset(host.roomId, host, 1);
  assert.equal(room.leaderboard[0].points, 1);
  assert.equal(room.finalized, false);
  await startVoting(host.roomId, host);
  await vote(host.roomId, host, "3", 2);
  await reveal(host.roomId, host);
  await assert.rejects(finalizeRound(host.roomId, host, 1), /round has ended/);
  await assert.rejects(reset(host.roomId, host, 1), /round has ended/);
  room = await reset(host.roomId, host, 2);
  assert.equal(room.leaderboard[0].points, 2);
});

test("zero can earn points but question, stout, and no numeric result cannot", async () => {
  const host = await createRoom("Zero");
  const guest = await joinRoom(host.roomId, "Question", null);
  const third = await joinRoom(host.roomId, "Stout", null);
  await startVoting(host.roomId, host);
  await vote(host.roomId, host, "0", 1);
  await vote(host.roomId, guest, "?", 1);
  await vote(host.roomId, third, "☕", 1);
  let room = await reset(host.roomId, host, 1);
  assert.equal(room.leaderboard[0].participantId, host.participantId);
  assert.equal(room.leaderboard[0].points, 1);
  assert.equal(room.leaderboard.filter((p) => p.points === 0).length, 2);
  await startVoting(host.roomId, host);
  await vote(host.roomId, host, "?", 2);
  await vote(host.roomId, guest, "☕", 2);
  room = await reset(host.roomId, host, 2);
  assert.equal(room.history[0].score, null);
  assert.equal(room.leaderboard[0].points, 1);
});

test("host departure finalises before removing votes and retains the departed player's points", async () => {
  const host = await createRoom("Departing host");
  const guest = await joinRoom(host.roomId, "Guest", null);
  await startVoting(host.roomId, host);
  await vote(host.roomId, host, "5", 1);
  await vote(host.roomId, guest, "5", 1);
  await leave(host.roomId, host);
  let room = await getRoom(host.roomId, guest);
  assert.equal(room.hostId, guest.participantId);
  assert.equal(room.finalized, true);
  assert.equal(room.summary?.totalVotes, 2);
  assert.equal(room.leaderboard.length, 2);
  assert.ok(room.leaderboard.every((p) => p.points === 1));
  room = await reset(host.roomId, guest, 1);
  assert.ok(room.leaderboard.every((p) => p.points === 1));
});

test("finalising while voting records the current result and duplicate resets cannot award twice", async () => {
  const host = await createRoom("Host");
  await joinRoom(host.roomId, "Not voted", null);
  await startVoting(host.roomId, host);
  await vote(host.roomId, host, "5", 1);
  let room = await finalizeRound(host.roomId, host, 1);
  assert.equal(room.phase, "revealed");
  assert.equal(room.summary?.nearest, 5);
  assert.equal(room.leaderboard[0].points, 1);
  await Promise.all([
    reset(host.roomId, host, 1),
    reset(host.roomId, host, 1),
  ]);
  room = await getRoom(host.roomId, host);
  assert.equal(room.round, 2);
  assert.equal(room.leaderboard[0].points, 1);
});

test("an exit finalisation racing a reset cannot reveal or award points for the next round", async () => {
  const host = await createRoom("Host");
  await joinRoom(host.roomId, "Guest", null);
  await startVoting(host.roomId, host);
  await vote(host.roomId, host, "5", 1);
  await Promise.all([
    finalizeRound(host.roomId, host, 1),
    reset(host.roomId, host, 1),
  ]);
  const room = await getRoom(host.roomId, host);
  assert.equal(room.round, 2);
  assert.equal(room.phase, "waiting");
  assert.equal(room.finalized, false);
  assert.equal(room.summary, null);
  assert.equal(room.leaderboard[0].points, 1);
});

test("renaming preserves participant identity, votes, host privileges, and earned points", async () => {
  const host = await createRoom("Host");
  const guest = await joinRoom(host.roomId, "Guest", null);
  await startVoting(host.roomId, host);
  await vote(host.roomId, host, "5", 1);
  let room = await renameParticipant(host.roomId, host, "  New   host  ");
  assert.equal(room.me?.id, host.participantId);
  assert.equal(room.me?.name, "New host");
  assert.equal(room.me?.vote, "5");
  assert.equal(room.me?.isHost, true);
  assert.equal(room.phase, "voting");
  assert.equal(room.participants.length, 2);
  assert.equal((await getRoom(host.roomId, guest)).participants.find((p) => p.id === host.participantId)?.name, "New host");
  await vote(host.roomId, guest, "5", 1);
  await reset(host.roomId, host, 1);
  room = await renameParticipant(host.roomId, guest, "New guest");
  assert.equal(room.me?.id, guest.participantId);
  assert.equal(room.leaderboard.find((p) => p.participantId === guest.participantId)?.name, "New guest");
  assert.equal(room.leaderboard.find((p) => p.participantId === guest.participantId)?.points, 1);
});

test("renaming requires valid credentials and a non-empty name without adding a participant", async () => {
  const host = await createRoom("Host");
  await assert.rejects(renameParticipant(host.roomId, null, "Intruder"), /not in this room/);
  await assert.rejects(renameParticipant(host.roomId, { participantId: host.participantId, token: "wrong" }, "Intruder"), /not in this room/);
  await assert.rejects(renameParticipant(host.roomId, host, "   "), /Name is required/);
  await assert.rejects(renameParticipant(host.roomId, host, null), /Name is required/);
  const room = await getRoom(host.roomId, host);
  assert.equal(room.participants.length, 1);
  assert.equal(room.me?.name, "Host");
});
