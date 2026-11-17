"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
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
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [duration, setDuration] = useState("45");
  const [admonished, setAdmonished] = useState(false);
  const admonishmentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const creds = useRef<Credentials | null>(null);
  const pendingVote = useRef(false);
  const latestRoom = useRef<PublicRoom | null>(null);

  useEffect(() => {
    latestRoom.current = room;
  }, [room]);

  useEffect(() => {
    if (status !== "joined") return;
    const finalizeOnExit = () => {
      const current = latestRoom.current;
      if (!current?.me?.isHost || current.phase === "waiting" || current.finalized || !creds.current) return;
      const body = JSON.stringify({ action: "finalize", round: current.round, ...creds.current });
      if (!navigator.sendBeacon(`/api/rooms/${id}`, new Blob([body], { type: "application/json" }))) {
        fetch(`/api/rooms/${id}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true,
        }).then((response) => {
          if (!response.ok) console.warn("Could not finalise the round on exit", response.status);
        }).catch((error: unknown) => console.warn("Could not finalise the round on exit", error));
      }
    };
    window.addEventListener("pagehide", finalizeOnExit);
    window.addEventListener("beforeunload", finalizeOnExit);
    return () => {
      window.removeEventListener("pagehide", finalizeOnExit);
      window.removeEventListener("beforeunload", finalizeOnExit);
      finalizeOnExit();
    };
  }, [id, status]);

  useEffect(() => () => {
    if (admonishmentTimer.current) clearTimeout(admonishmentTimer.current);
  }, []);

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
    if (room.phase === "waiting") {
      setAdmonished(true);
      if (admonishmentTimer.current) clearTimeout(admonishmentTimer.current);
      admonishmentTimer.current = setTimeout(() => setAdmonished(false), 1800);
      return;
    }
    if (room.finalized) return;
    const next = room.me.vote === value ? null : value;
    setRoom({ ...room, me: { ...room.me, vote: next } });
    pendingVote.current = true;
    await act({ action: "vote", value: next, round: room.round });
    pendingVote.current = false;
  }

  async function leaveRoom() {
    try {
      await request({ action: "leave" });
      clearCredentials(id);
      creds.current = null;
      setStatus("left");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function renameSelf(event: React.FormEvent) {
    event.preventDefault();
    setRenameBusy(true);
    setError(null);
    try {
      const next: PublicRoom = await request({ action: "rename", name: renameDraft });
      if (!next.me) throw new Error("Could not update your name");
      setRoom(next);
      setName(next.me.name);
      localStorage.setItem(NAME_KEY, next.me.name);
      setRenaming(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRenameBusy(false);
    }
  }

  async function finalizeAndGoHome() {
    if (!room) return;
    try {
      setRoom(await request({ action: "finalize", round: room.round }));
      router.push("/");
    } catch (e) {
      setError((e as Error).message);
    }
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
  const waiting = room.phase === "waiting";
  const active = room.participants.filter((p) => p.active);
  const votedCount = active.filter((p) => p.hasVoted).length;
  const me = room.me;
  const maxCount = Math.max(1, ...(room.summary?.distribution.map((d) => d.count) ?? []));

  return (
    <main className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 items-start gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 max-w-full">
          <Link href="/" className="text-sm text-zinc-500 hover:underline" onNavigate={(event) => {
            if (me?.isHost && !waiting && !room.finalized) {
              event.preventDefault();
              finalizeAndGoHome();
            }
          }}>
            EstimationX
          </Link>
          <h1 className="text-2xl font-bold [overflow-wrap:anywhere]">
            {room.roomName || <>Room <span className="font-mono">{room.id}</span></>}{" "}
            <span className="text-base font-normal text-zinc-500">· Round {room.round}</span>
          </h1>
          {room.roomName && <p className="text-sm text-zinc-500">Room code: <span className="font-mono">{room.id}</span></p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" aria-expanded={renaming} aria-controls="rename-form" onClick={() => {
            setRenameDraft(me?.name ?? name);
            setRenaming(true);
          }}>
            Rename yourself
          </button>
          <button className="btn-secondary" onClick={copyLink}>
            {copied ? "Copied!" : "Copy invite link"}
          </button>
          <button className="btn-secondary" onClick={leaveRoom}>
            Leave
          </button>
        </div>
      </header>

      {renaming && (
        <form id="rename-form" className="panel flex flex-wrap items-end gap-3" onSubmit={renameSelf}>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            Your display name
            <input className="input w-full" value={renameDraft} maxLength={30} autoFocus required
              onChange={(event) => setRenameDraft(event.target.value)} />
          </label>
          <button className="btn-primary" disabled={renameBusy || !renameDraft.trim()}>
            {renameBusy ? "Saving…" : "Save name"}
          </button>
          <button className="btn-secondary" type="button" disabled={renameBusy} onClick={() => setRenaming(false)}>
            Cancel
          </button>
        </form>
      )}

      <section className="panel">
        <h2 className="text-lg font-semibold">{room.voteName || `Vote ${room.round}`}</h2>
        {me?.canManage && !room.finalized && (
          <VoteNameEditor key={`${room.round}:${room.voteName}`} initialName={room.voteName}
            onSave={(name) => act({ action: "name", name })} />
        )}
      </section>

      <section className="panel flex flex-wrap items-center justify-between gap-3">
        <p className="font-medium" data-testid="status">
          {room.finalized
            ? "Round finalised — points awarded. Reset for the next round."
            : revealed
            ? "Votes revealed — you can still change your vote while you discuss."
            : waiting ? "Waiting for the host to start voting." : `${votedCount} of ${active.length} voted`}
        </p>
        {me?.canManage && (
          <div className="flex flex-wrap items-center gap-2">
            {waiting && (
              <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => {
                event.preventDefault();
                act({ action: "start", duration: Number(duration) });
              }}>
                <label className="flex items-center gap-2 text-sm">
                  Timer (seconds)
                  <input className="input w-24" type="number" min="1" max="3600" step="1" required
                    value={duration} onChange={(event) => setDuration(event.target.value)} />
                </label>
                <button className="btn-primary">Start voting</button>
              </form>
            )}
            {!revealed && !waiting && (
              <button className="btn-primary" onClick={() => act({ action: "reveal" })}>
                End voting &amp; reveal
              </button>
            )}
            <button className={revealed ? "btn-primary" : "btn-secondary"} onClick={() => act({ action: "reset", round: room.round })}>
              Reset for next round
            </button>
          </div>
        )}
      </section>

      {room.phase === "voting" && !room.finalized && room.voteEndsAt !== null && (
        <VotingTimer key={room.voteEndsAt} endsAt={room.voteEndsAt} isHost={me?.isHost ?? false}
          onReveal={() => act({ action: "reveal" })} />
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {revealed && room.summary && (
        <section className="panel grid gap-6 sm:grid-cols-[auto_auto_1fr]">
          <Stat label="Average" value={room.summary.average === null ? "—" : formatAverage(room.summary.average)} />
          <Stat label="Closest Fibonacci" value={room.summary.nearest === null ? "—" : String(room.summary.nearest)} highlight />
          <div className="flex flex-col gap-1">
            {room.summary.distribution.map((d) => (
              <div key={d.value} className="flex items-center gap-2 text-sm">
                <span className="flex w-8 justify-end font-mono"><CardFace value={d.value} /></span>
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
              {revealed ? <CardFace value={p.vote ?? "–"} /> : p.hasVoted ? "✓" : ""}
            </div>
            <span className="max-w-full truncate text-sm" title={p.name}>
              {p.id === room.hostId && "👑 "}
              {p.name}
              {!p.active && " (away)"}
            </span>
          </div>
        ))}
      </section>

      <section className="mt-auto text-center" aria-label="Voting cards">
        <p className="mb-2 text-sm text-zinc-500">{room.finalized ? "This round is finalised." : waiting ? "Cards unlock when voting starts." : me?.vote ? "Your vote — tap again to clear" : "Pick a card"}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {DECK.map((card) => (
            <button
              key={card}
              aria-disabled={waiting || room.finalized}
              onClick={() => castVote(card)}
              aria-pressed={me?.vote === card}
              className={`flex h-20 w-14 items-center justify-center rounded-xl border-2 text-xl font-bold transition aria-disabled:cursor-not-allowed aria-disabled:opacity-40 ${
                me?.vote === card
                  ? "-translate-y-2 border-indigo-600 bg-indigo-600 text-white"
                  : `border-zinc-300 dark:border-zinc-700 ${waiting || room.finalized ? "" : "hover:-translate-y-1 hover:border-indigo-400"}`
              }`}
            >
              <CardFace value={card} />
            </button>
          ))}
        </div>
        <p role="status" className="mt-2 min-h-5 text-xs text-zinc-500">
          {waiting && admonished ? "Stop that." : ""}
        </p>
      </section>
      </div>
      <aside className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-6" aria-label="Room sidebar">
      <section className="panel" aria-label="Vote history">
        <h2 className="mb-4 text-lg font-semibold">History</h2>
        {room.history.length === 0 ? (
          <p className="text-sm text-zinc-500">Revealed votes will appear here.</p>
        ) : (
          <ol className="flex flex-col gap-4">
            {room.history.map((entry) => (
              <li key={entry.round} className="border-b border-zinc-200 pb-3 last:border-0 dark:border-zinc-800">
                <time dateTime={new Date(entry.timestamp).toISOString()} className="text-xs text-zinc-500">
                  {new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(entry.timestamp)}
                </time>
                <div className="mt-1 flex items-start justify-between gap-3">
                  <span className="min-w-0 break-words font-medium">{entry.name || `Vote ${entry.round}`}</span>
                  <span className="font-mono text-lg font-bold text-indigo-600 dark:text-indigo-400"
                    aria-label={`Score: ${entry.score ?? "none"}`}>
                    {entry.score ?? "—"}
                  </span>
                </div>
                <p className="text-xs text-zinc-500">
                  Round {entry.round} · Average: {entry.average === null ? "—" : formatAverage(entry.average)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="panel" aria-label="Leaderboard">
        <h2 className="mb-2 text-lg font-semibold">Leaderboard</h2>
        <p className="mb-4 text-xs text-zinc-500">
          One point if your first pre-reveal vote matches the final Fibonacci score.
          Points are awarded on reset or when the host leaves.
        </p>
        <ol className="flex flex-col gap-3">
          {room.leaderboard.map((player) => (
            <li key={player.participantId} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate" title={player.name}>
                {player.name}{player.participantId === me?.id ? " (you)" : ""}
              </span>
              <span className="shrink-0 font-mono font-semibold">
                {player.points} {player.points === 1 ? "point" : "points"}
              </span>
            </li>
          ))}
        </ol>
      </section>
      </aside>
    </main>
  );
}

function CardFace({ value }: { value: string }) {
  if (value !== "☕") return value;
  return (
    <svg viewBox="0 0 32 40" className="h-8 w-6" role="img" aria-label="Pint of Irish stout">
      <path d="M5 8h22l-3 28H8Z" fill="#211814" stroke="#a1a1aa" strokeWidth="1.5" />
      <path d="M5 8c0-3 3-5 6-4 2-3 7-3 9 0 4-1 7 1 7 4v5H5Z" fill="#f5e6ca" stroke="#a1a1aa" strokeWidth="1" />
      <path d="m9 17 1.5 15" stroke="#fff" strokeOpacity=".2" strokeWidth="1.5" />
    </svg>
  );
}

function VoteNameEditor({ initialName, onSave }: { initialName: string; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initialName);
  return (
    <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => {
      event.preventDefault();
      onSave(name);
    }}>
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        Vote name (optional)
        <input className="input w-full" placeholder="e.g. FS-1234" maxLength={100}
          value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <button className="btn-secondary" disabled={name === initialName}>Save vote name</button>
    </form>
  );
}

function VotingTimer({ endsAt, isHost, onReveal }: { endsAt: number; isHost: boolean; onReveal: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  const remaining = Math.max(0, Math.ceil((endsAt - now) / 1000));
  return (
    <section className="panel flex flex-wrap items-center justify-between gap-3">
      <p role="timer" aria-label="Voting time remaining" className="font-mono text-lg tabular-nums">
        {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
      </p>
      {remaining === 0 && isHost && !dismissed && (
        <div className="flex flex-wrap items-center gap-3">
          <p role="status">Time is up. End voting or give everyone more time.</p>
          <button className="btn-primary" onClick={onReveal}>End voting &amp; reveal</button>
          <button className="btn-secondary" onClick={() => setDismissed(true)}>Keep voting</button>
        </div>
      )}
    </section>
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
