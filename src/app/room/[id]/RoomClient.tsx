"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { authHeaders, clearCredentials, loadCredentials, NAME_KEY, saveCredentials } from "@/lib/client";
import type { Credentials, PublicRoom } from "@/lib/rooms";
import { DECK } from "@/lib/scoring";

const POLL_MS = 2000;
const HIDDEN_POLL_MS = 10000;
const HEARTBEAT_MS = 20000;

type Status = "loading" | "needs-name" | "joined" | "not-found" | "left";

export default function RoomClient() {
  const { id } = useParams<{ id: string }>();
  const [status, setStatus] = useState<Status>("loading");
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const creds = useRef<Credentials | null>(null);
  const pendingVote = useRef(false);

  const request = useCallback(
    async (body?: object) => {
      const res = await fetch(`/api/rooms/${id}`, {
        method: body ? "POST" : "GET",
        cache: "no-store",
        headers: { "Content-Type": "application/json", ...authHeaders(creds.current) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 404) {
        setStatus("not-found");
        throw new Error("Room not found");
      }
      const data = res.status === 204 ? null : await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Something went wrong");
      return data;
    },
    [id],
  );

  const join = useCallback(
    async (displayName: string) => {
      setError(null);
      try {
        const result = await request({ action: "join", name: displayName });
        creds.current = { participantId: result.participantId, token: result.token };
        saveCredentials(id, creds.current);
        localStorage.setItem(NAME_KEY, displayName.trim());
        setRoom(await request());
        setStatus("joined");
      } catch (e) {
        setError((e as Error).message);
        setStatus((s) => (s === "not-found" ? s : "needs-name"));
      }
    },
    [id, request],
  );

  useEffect(() => {
    creds.current = loadCredentials(id);
    const storedName = localStorage.getItem(NAME_KEY) ?? "";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from localStorage after mount
    setName(storedName);
    if (storedName) join(storedName);
    else setStatus("needs-name");
  }, [id, join]);

  useEffect(() => {
    if (status !== "joined") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const next: PublicRoom = await request();
        if (cancelled) return;
        if (!next.me) {
          // We were pruned for inactivity; quietly rejoin.
          await join(localStorage.getItem(NAME_KEY) || name || "Guest");
        } else if (!pendingVote.current) {
          setRoom(next);
        }
      } catch {
        // Transient network errors: keep polling.
      }
      if (!cancelled) timer = setTimeout(poll, document.hidden ? HIDDEN_POLL_MS : POLL_MS);
    };
    timer = setTimeout(poll, POLL_MS);

    const beat = setInterval(() => request({ action: "heartbeat" }).catch(() => {}), HEARTBEAT_MS);
    const onVisible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        request({ action: "heartbeat" }).catch(() => {});
        poll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(beat);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [status, request, join, name]);

  async function act(body: object) {
    setError(null);
    try {
      const next = await request(body);
      if (next) setRoom(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function castVote(value: string) {
    if (!room?.me) return;
    const next = room.me.vote === value ? null : value;
    setRoom({ ...room, me: { ...room.me, vote: next } });
    pendingVote.current = true;
    await act({ action: "vote", value: next, round: room.round });
    pendingVote.current = false;
  }

  async function leaveRoom() {
    await request({ action: "leave" }).catch(() => {});
    clearCredentials(id);
    creds.current = null;
    setStatus("left");
  }

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (status === "loading") return <Centered>Joining room…</Centered>;

  if (status === "not-found")
    return (
      <Centered>
        <p className="text-lg font-semibold">Room not found</p>
        <p className="text-zinc-500">It may have expired (rooms last 24 hours).</p>
        <Link href="/" className="btn-primary mt-4">
          Back home
        </Link>
      </Centered>
    );

  if (status === "left")
    return (
      <Centered>
        <p className="text-lg font-semibold">You left the room</p>
        <div className="mt-4 flex gap-3">
          <button className="btn-secondary" onClick={() => join(name)}>
            Rejoin
          </button>
          <Link href="/" className="btn-primary">
            Home
          </Link>
        </div>
      </Centered>
    );

  if (status === "needs-name" || !room)
    return (
      <Centered>
        <form
          className="panel flex w-full max-w-sm flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            join(name);
          }}
        >
          <h1 className="text-lg font-semibold">Join room {id}</h1>
          <input
            className="input"
            placeholder="Your name"
            value={name}
            maxLength={30}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
          />
          <button className="btn-primary" disabled={!name.trim()}>
            Join
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      </Centered>
    );

  const revealed = room.phase === "revealed";
  const active = room.participants.filter((p) => p.active);
  const votedCount = active.filter((p) => p.hasVoted).length;
  const me = room.me;
  const maxCount = Math.max(1, ...(room.summary?.distribution.map((d) => d.count) ?? []));

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/" className="text-sm text-zinc-500 hover:underline">
            EstimationX
          </Link>
          <h1 className="text-2xl font-bold">
            Room <span className="font-mono">{room.id}</span>{" "}
            <span className="text-base font-normal text-zinc-500">· Round {room.round}</span>
          </h1>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={copyLink}>
            {copied ? "Copied!" : "Copy invite link"}
          </button>
          <button className="btn-secondary" onClick={leaveRoom}>
            Leave
          </button>
        </div>
      </header>

      <section className="panel flex flex-wrap items-center justify-between gap-3">
        <p className="font-medium" data-testid="status">
          {revealed
            ? "Votes revealed — you can still change your vote while you discuss."
            : `${votedCount} of ${active.length} voted`}
        </p>
        {me?.canManage && (
          <div className="flex gap-2">
            {!revealed && (
              <button className="btn-primary" onClick={() => act({ action: "reveal" })}>
                End voting &amp; reveal
              </button>
            )}
            <button className={revealed ? "btn-primary" : "btn-secondary"} onClick={() => act({ action: "reset" })}>
              Reset for next round
            </button>
          </div>
        )}
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {revealed && room.summary && (
        <section className="panel grid gap-6 sm:grid-cols-[auto_auto_1fr]">
          <Stat label="Average" value={room.summary.average === null ? "—" : formatAverage(room.summary.average)} />
          <Stat label="Closest Fibonacci" value={room.summary.nearest === null ? "—" : String(room.summary.nearest)} highlight />
          <div className="flex flex-col gap-1">
            {room.summary.distribution.map((d) => (
              <div key={d.value} className="flex items-center gap-2 text-sm">
                <span className="w-8 text-right font-mono">{d.value}</span>
                <div className="h-4 rounded bg-indigo-500" style={{ width: `${(d.count / maxCount) * 100}%`, minWidth: 8 }} />
                <span className="text-zinc-500">{d.count}</span>
              </div>
            ))}
            {room.summary.totalVotes === 0 && <p className="text-sm text-zinc-500">No votes cast.</p>}
          </div>
        </section>
      )}

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-5">
        {room.participants.map((p) => (
          <div
            key={p.id}
            className={`panel flex flex-col items-center gap-2 !p-3 ${p.active ? "" : "opacity-40"} ${p.id === me?.id ? "ring-2 ring-indigo-500" : ""}`}
          >
            <div
              className={`flex h-16 w-12 items-center justify-center rounded-lg border-2 text-xl font-bold ${
                p.hasVoted ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950" : "border-dashed border-zinc-300 dark:border-zinc-700"
              }`}
            >
              {revealed ? (p.vote ?? "–") : p.hasVoted ? "✓" : ""}
            </div>
            <span className="max-w-full truncate text-sm" title={p.name}>
              {p.id === room.hostId && "👑 "}
              {p.name}
              {!p.active && " (away)"}
            </span>
          </div>
        ))}
      </section>

      <section className="mt-auto">
        <p className="mb-2 text-sm text-zinc-500">{me?.vote ? "Your vote — tap again to clear" : "Pick a card"}</p>
        <div className="flex flex-wrap gap-2">
          {DECK.map((card) => (
            <button
              key={card}
              onClick={() => castVote(card)}
              aria-pressed={me?.vote === card}
              className={`h-20 w-14 rounded-xl border-2 text-xl font-bold transition ${
                me?.vote === card
                  ? "-translate-y-2 border-indigo-600 bg-indigo-600 text-white"
                  : "border-zinc-300 hover:-translate-y-1 hover:border-indigo-400 dark:border-zinc-700"
              }`}
            >
              {card}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

function formatAverage(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-sm text-zinc-500">{label}</span>
      <span className={`text-4xl font-bold ${highlight ? "text-indigo-600 dark:text-indigo-400" : ""}`}>{value}</span>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">{children}</main>;
}
