import { createRoom, RoomError } from "@/lib/rooms";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    return Response.json(await createRoom(body.name, {
      squad: body.squad, year: body.year, quarter: body.quarter, sprintNumber: body.sprintNumber,
    }), { status: 201 });
  } catch (error) {
    if (error instanceof RoomError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
