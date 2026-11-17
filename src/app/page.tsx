"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { NAME_KEY, saveCredentials } from "@/lib/client";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from localStorage after mount
    setName(localStorage.getItem(NAME_KEY) ?? "");
  }, []);

  async function createRoom(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create room");
      localStorage.setItem(NAME_KEY, name.trim());
      saveCredentials(data.roomId, { participantId: data.participantId, token: data.token });
      router.push(`/room/${data.roomId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  function joinRoom(event: React.FormEvent) {
    event.preventDefault();
    const id = code.trim().replace(/\/+$/, "").split("/").pop()?.toLowerCase();
    if (id) router.push(`/room/${id}`);
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-10 p-6">
      <header className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">EstimationX</h1>
        <p className="mt-2 text-zinc-500">Planning poker for teams of up to 20.</p>
      </header>

      <form onSubmit={createRoom} className="panel flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Start a new room</h2>
        <input
          className="input"
          placeholder="Your name"
          value={name}
          maxLength={30}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button className="btn-primary" disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create room"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      <form onSubmit={joinRoom} className="panel flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Join a room</h2>
        <input
          className="input"
          placeholder="Room code or link"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
        <button className="btn-secondary" disabled={!code.trim()}>
          Join
        </button>
      </form>
    </main>
  );
}
