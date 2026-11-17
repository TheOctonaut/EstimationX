import type { NextRequest } from "next/server";
import { finalizeRound, getRoom, heartbeat, joinRoom, leave, nameVote, reset, reveal, RoomError, startVoting, vote, type Credentials } from "@/lib/rooms";

function credentialsFrom(request: NextRequest): Partial<Credentials> {
  return {
    participantId: request.headers.get("x-participant-id") ?? undefined,
    token: request.headers.get("x-participant-token") ?? undefined,
  };
}

function handleError(error: unknown) {
  if (error instanceof RoomError) return Response.json({ error: error.message }, { status: error.status });
  throw error;
}

export async function GET(request: NextRequest, ctx: RouteContext<"/api/rooms/[id]">) {
  const { id } = await ctx.params;
  try {
    return Response.json(await getRoom(id, credentialsFrom(request)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest, ctx: RouteContext<"/api/rooms/[id]">) {
  const { id } = await ctx.params;
  const creds = credentialsFrom(request);
  try {
    const body = await request.json().catch(() => ({}));
    switch (body.action) {
      case "finalize":
        return Response.json(await finalizeRound(id, {
          participantId: creds.participantId ?? (typeof body.participantId === "string" ? body.participantId : undefined),
          token: creds.token ?? (typeof body.token === "string" ? body.token : undefined),
        }, body.round));
      case "name":
        return Response.json(await nameVote(id, creds, body.name));
      case "start":
        return Response.json(await startVoting(id, creds, body.duration));
      case "join":
        return Response.json(await joinRoom(id, body.name, creds));
      case "heartbeat":
        await heartbeat(id, creds);
        return new Response(null, { status: 204 });
      case "vote":
        return Response.json(await vote(id, creds, body.value ?? null, body.round));
      case "reveal":
        return Response.json(await reveal(id, creds));
      case "reset":
        return Response.json(await reset(id, creds, body.round));
      case "leave":
        await leave(id, creds);
        return new Response(null, { status: 204 });
      default:
        return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    return handleError(error);
  }
}
