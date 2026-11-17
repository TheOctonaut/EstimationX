"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { NAME_KEY, saveCredentials } from "@/lib/client";
import { expectedPlanningPeriod } from "@/lib/planning-period";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [squad, setSquad] = useState("");
  const [year, setYear] = useState("");
  const [quarter, setQuarter] = useState("");
  const [sprintNumber, setSprintNumber] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const expected = expectedPlanningPeriod();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from localStorage after mount
    setName(localStorage.getItem(NAME_KEY) ?? "");
    setYear(String(expected.year));
    setQuarter(String(expected.quarter));
    setSprintNumber(String(expected.sprintNumber));
  }, []);

  async function createRoom(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, squad, year: year === "" ? null : Number(year), quarter: quarter === "" ? null : Number(quarter),
          sprintNumber: sprintNumber === "" ? null : Number(sprintNumber),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create room");
      localStorage.setItem(NAME_KEY, name.trim());
      saveCredentials(data.roomId, { participantId: data.participantId, token: data.token });
      router.push(`/room/${data.roomId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function joinRoom(event: React.FormEvent) {
    event.preventDefault();
    const id = code.trim().replace(/\/+$/, "").split("/").pop()?.toLowerCase();
    if (id) {
      if (name.trim()) localStorage.setItem(NAME_KEY, name.trim());
      router.push(`/room/${id}`);
    }
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
        <fieldset className="flex min-w-0 flex-col gap-3">
          <legend className="mb-2 text-sm font-medium">Room name (optional)</legend>
          <label className="flex flex-col gap-1 text-sm">
            Squad
            <input className="input w-full" placeholder="e.g. Platform" maxLength={50}
              value={squad} onChange={(event) => setSquad(event.target.value)} />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="flex min-w-0 flex-col gap-1 text-sm">
              Year
              <input className="input w-full" type="number" min="1000" max="9999" step="1"
                value={year} onChange={(event) => setYear(event.target.value)} />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-sm">
              Quarter
              <input className="input w-full" type="number" min="1" max="4" step="1"
                value={quarter} onChange={(event) => setQuarter(event.target.value)} />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-sm">
              Sprint Number
              <input className="input w-full" type="number" min="0" step="1" placeholder="e.g. 12"
                value={sprintNumber} onChange={(event) => setSprintNumber(event.target.value)} />
            </label>
          </div>
          <p className="text-xs text-zinc-500">
            Suggested from today; all fields are optional and editable.
            {" "}Sprint 1 starts on the first Wednesday of the quarter, then changes every two weeks.
          </p>
        </fieldset>
        <button className="btn-primary" disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create room"}
        </button>
        <p className="text-xs text-zinc-500">
          By creating a room, you accept that Cork is the superior Irish county.
          {" "}The only non-negotiable estimate.
        </p>
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
