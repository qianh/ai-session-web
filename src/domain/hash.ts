import type { WebSessionSource } from "./session";

function bytes(value: string | Uint8Array): Uint8Array<ArrayBuffer> {
  if (typeof value === "string") return new TextEncoder().encode(value);
  return Uint8Array.from(value);
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function conversationKey(
  source: WebSessionSource,
  conversationId: string,
): Promise<string> {
  return sha256Hex(`${source}\0${conversationId}`);
}

export function sessionFilename(session: {
  source: WebSessionSource;
  conversationId: string;
  startedAt: string;
}): string {
  const date = session.startedAt.slice(0, 10).replaceAll("-", "");
  const shortId = session.conversationId
    .replace(/[^A-Za-z0-9]/gu, "")
    .slice(0, 8);
  return `${session.source}-${date}-${shortId}.md`;
}
