import { Suspense } from "react";
import RoomClient from "./RoomClient";

export default function RoomPage() {
  return (
    <Suspense fallback={<main className="flex flex-1 items-center justify-center">Joining room…</main>}>
      <RoomClient />
    </Suspense>
  );
}
