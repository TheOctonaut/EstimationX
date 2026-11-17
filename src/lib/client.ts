import type { Credentials } from "./rooms";

export const NAME_KEY = "estimationx:name";
const credsKey = (roomId: string) => `estimationx:room:${roomId}`;

export function loadCredentials(roomId: string): Credentials | null {
  try {
    const raw = localStorage.getItem(credsKey(roomId));
    return raw ? (JSON.parse(raw) as Credentials) : null;
  } catch {
    return null;
  }
}

export function saveCredentials(roomId: string, creds: Credentials) {
  localStorage.setItem(credsKey(roomId), JSON.stringify(creds));
}

export function clearCredentials(roomId: string) {
  localStorage.removeItem(credsKey(roomId));
}

export function authHeaders(creds: Credentials | null): Record<string, string> {
  return creds ? { "x-participant-id": creds.participantId, "x-participant-token": creds.token } : {};
}
