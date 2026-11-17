import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isCardValue, summarize, type Summary } from "./scoring";
import { getStore } from "./store";

export const MAX_PARTICIPANTS = 20;
/** Participants are considered present if they've sent a heartbeat this recently. */
export const ACTIVE_WINDOW_MS = 60_000;
const ROOM_TTL_SECONDS = 60 * 60 * 24;
const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export type Phase = "voting" | "revealed";

interface StoredParticipant {
  name: string;
  joinedAt: number;
  lastSeen: number;
  tokenHash: string;
}

interface Room {
  id: string;
  phase: Phase;
  round: number;
  hostId: string;
  participants: Map<string, StoredParticipant>;
  votes: Map<string, string>;
}

export interface Credentials {
  participantId: string;
  token: string;
}

export interface PublicRoom {
  id: string;
  phase: Phase;
  round: number;
  hostId: string;
  participants: { id: string; name: string; active: boolean; hasVoted: boolean; vote: string | null }[];
  summary: Summary | null;
  me: { id: string; name: string; vote: string | null; isHost: boolean; canManage: boolean } | null;
}

export class RoomError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const key = (roomId: string) => `room:${roomId}`;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function randomId(length: number) {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}

export function isValidRoomId(id: string) {
  return /^[a-z0-9]{6,16}$/.test(id);
}

function cleanName(name: unknown) {
  if (typeof name !== "string") throw new RoomError("Name is required", 400);
  const trimmed = name.trim().replace(/\s+/g, " ").slice(0, 30);
  if (!trimmed) throw new RoomError("Name is required", 400);
  return trimmed;
}

async function load(roomId: string): Promise<Room> {
  if (!isValidRoomId(roomId)) throw new RoomError("Room not found", 404);
  const fields = await getStore().getAll(key(roomId));
  if (!fields || !fields.host) throw new RoomError("Room not found", 404);

  const participants = new Map<string, StoredParticipant>();
  const votes = new Map<string, string>();
  for (const [field, value] of Object.entries(fields)) {
    if (field.startsWith("p:")) participants.set(field.slice(2), JSON.parse(value));
    else if (field.startsWith("v:")) votes.set(field.slice(2), value);
  }
  return {
    id: roomId,
    phase: fields.phase === "revealed" ? "revealed" : "voting",
    round: Number(fields.round) || 1,
    hostId: fields.host,
    participants,
    votes,
  };
}

const save = (roomId: string, fields: Record<string, string>) => getStore().set(key(roomId), fields, ROOM_TTL_SECONDS);

const isActive = (p: StoredParticipant, now = Date.now()) => now - p.lastSeen <= ACTIVE_WINDOW_MS;

function authenticate(room: Room, creds: Partial<Credentials> | null): string | null {
  if (!creds?.participantId || !creds.token) return null;
  const participant = room.participants.get(creds.participantId);
  if (!participant) return null;
  const expected = Buffer.from(participant.tokenHash, "hex");
  const actual = Buffer.from(hashToken(creds.token), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? creds.participantId : null;
}

function requireParticipant(room: Room, creds: Partial<Credentials> | null) {
  const id = authenticate(room, creds);
  if (!id) throw new RoomError("You are not in this room", 401);
  return id;
}

/** The host manages the room; if the host has gone away, anyone may step in. */
function canManage(room: Room, participantId: string) {
  const host = room.participants.get(room.hostId);
  return participantId === room.hostId || !host || !isActive(host);
}

function toPublic(room: Room, meId: string | null): PublicRoom {
  const now = Date.now();
  const revealed = room.phase === "revealed";
  const participants = [...room.participants.entries()]
    .sort(([, a], [, b]) => a.joinedAt - b.joinedAt)
    .map(([id, p]) => ({
      id,
      name: p.name,
      active: isActive(p, now),
      hasVoted: room.votes.has(id),
      vote: revealed ? (room.votes.get(id) ?? null) : null,
    }));
  const me = meId ? room.participants.get(meId) : undefined;
  return {
    id: room.id,
    phase: room.phase,
    round: room.round,
    hostId: room.hostId,
    participants,
    summary: revealed ? summarize([...room.votes.values()]) : null,
    me:
      me && meId
        ? {
            id: meId,
            name: me.name,
            vote: room.votes.get(meId) ?? null,
            isHost: meId === room.hostId,
            canManage: canManage(room, meId),
          }
        : null,
  };
}

function newParticipant(name: string) {
  const id = randomId(10);
  const token = randomBytes(24).toString("base64url");
  const now = Date.now();
  const participant: StoredParticipant = { name, joinedAt: now, lastSeen: now, tokenHash: hashToken(token) };
  return { id, token, participant };
}

export async function createRoom(name: unknown) {
  const cleaned = cleanName(name);
  const roomId = randomId(8);
  const { id, token, participant } = newParticipant(cleaned);
  await save(roomId, {
    phase: "voting",
    round: "1",
    host: id,
    createdAt: String(Date.now()),
    [`p:${id}`]: JSON.stringify(participant),
  });
  return { roomId, participantId: id, token };
}

export async function getRoom(roomId: string, creds: Partial<Credentials> | null) {
  const room = await load(roomId);
  return toPublic(room, authenticate(room, creds));
}

export async function joinRoom(roomId: string, name: unknown, creds: Partial<Credentials> | null) {
  const cleaned = cleanName(name);
  const room = await load(roomId);
  const existingId = authenticate(room, creds);

  if (existingId) {
    const participant = { ...room.participants.get(existingId)!, name: cleaned, lastSeen: Date.now() };
    await save(roomId, { [`p:${existingId}`]: JSON.stringify(participant) });
    return { participantId: existingId, token: creds!.token! };
  }

  const now = Date.now();
  const stale = [...room.participants.entries()].filter(([id, p]) => !isActive(p, now) && id !== room.hostId);
  const activeCount = [...room.participants.values()].filter((p) => isActive(p, now)).length;
  if (activeCount >= MAX_PARTICIPANTS) throw new RoomError(`This room is full (${MAX_PARTICIPANTS} people max)`, 409);

  if (stale.length) await getStore().remove(key(roomId), stale.flatMap(([id]) => [`p:${id}`, `v:${id}`]));
  const { id, token, participant } = newParticipant(cleaned);
  await save(roomId, { [`p:${id}`]: JSON.stringify(participant) });
  return { participantId: id, token };
}

export async function heartbeat(roomId: string, creds: Partial<Credentials> | null) {
  const room = await load(roomId);
  const id = requireParticipant(room, creds);
  const participant = { ...room.participants.get(id)!, lastSeen: Date.now() };
  await save(roomId, { [`p:${id}`]: JSON.stringify(participant) });
}

export async function vote(roomId: string, creds: Partial<Credentials> | null, value: unknown, round: unknown) {
  let room = await load(roomId);
  const id = requireParticipant(room, creds);
  if (round !== undefined && Number(round) !== room.round) throw new RoomError("That round has ended", 409);

  if (value === null) {
    await getStore().remove(key(roomId), [`v:${id}`]);
  } else if (isCardValue(value)) {
    await save(roomId, { [`v:${id}`]: value });
  } else {
    throw new RoomError("Invalid card", 400);
  }

  room = await load(roomId);
  if (room.phase === "voting") {
    const active = [...room.participants.entries()].filter(([, p]) => isActive(p));
    if (active.length > 0 && active.every(([pid]) => room.votes.has(pid))) {
      await save(roomId, { phase: "revealed" });
      room.phase = "revealed";
    }
  }
  return toPublic(room, id);
}

export async function reveal(roomId: string, creds: Partial<Credentials> | null) {
  const room = await load(roomId);
  const id = requireParticipant(room, creds);
  if (!canManage(room, id)) throw new RoomError("Only the host can end voting", 403);
  await save(roomId, { phase: "revealed" });
  room.phase = "revealed";
  return toPublic(room, id);
}

export async function reset(roomId: string, creds: Partial<Credentials> | null) {
  const room = await load(roomId);
  const id = requireParticipant(room, creds);
  if (!canManage(room, id)) throw new RoomError("Only the host can reset the round", 403);
  await getStore().remove(key(roomId), [...room.votes.keys()].map((pid) => `v:${pid}`));
  const host = room.participants.get(room.hostId);
  const fields: Record<string, string> = { phase: "voting", round: String(room.round + 1) };
  if (!host || !isActive(host)) fields.host = id;
  await save(roomId, fields);
  return getRoom(roomId, creds);
}

export async function leave(roomId: string, creds: Partial<Credentials> | null) {
  const room = await load(roomId);
  const id = requireParticipant(room, creds);
  await getStore().remove(key(roomId), [`p:${id}`, `v:${id}`]);
  if (id === room.hostId) {
    const successor = [...room.participants.entries()]
      .filter(([pid, p]) => pid !== id && isActive(p))
      .sort(([, a], [, b]) => a.joinedAt - b.joinedAt)[0];
    if (successor) await save(roomId, { host: successor[0] });
  }
}
