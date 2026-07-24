import { redactText } from "../domain/redact";

export interface PreparedHighlight {
  id: string;
  capturedAt: string;
  text: string;
  bytes: Uint8Array;
  path: string;
  redactionVersion: 1;
  redactionCount: number;
}

export const HIGHLIGHT_MAX_BYTES = 512 * 1024;

interface PrepareHighlightOptions {
  now?: () => Date;
  randomUUID?: () => string;
}

export class HighlightPreparationError extends Error {
  constructor(readonly code: "HIGHLIGHT_EMPTY" | "HIGHLIGHT_TOO_LARGE") {
    super(code);
    this.name = "HighlightPreparationError";
  }
}

function compactUtcTimestamp(date: Date): string {
  const iso = date.toISOString();
  const day = iso.slice(0, 10).replaceAll("-", "");
  const time = iso.slice(11, 19).replaceAll(":", "");
  return `${day}-${time}`;
}

export async function prepareHighlight(
  selectionText: string,
  options: PrepareHighlightOptions = {},
): Promise<PreparedHighlight> {
  const selectedText = selectionText.trim();
  if (!selectedText) throw new HighlightPreparationError("HIGHLIGHT_EMPTY");
  if (new TextEncoder().encode(selectedText).byteLength > HIGHLIGHT_MAX_BYTES) {
    throw new HighlightPreparationError("HIGHLIGHT_TOO_LARGE");
  }
  const redacted = redactText(selectedText);
  const text = redacted.text;
  const bytes = new TextEncoder().encode(text);
  const capturedAt = (options.now ?? (() => new Date()))().toISOString();
  const id = (options.randomUUID ?? (() => crypto.randomUUID()))();
  const month = capturedAt.slice(0, 7);
  const timestamp = compactUtcTimestamp(new Date(capturedAt));
  const filename = `highlight-${timestamp}-${id.slice(0, 8)}.txt`;
  return {
    id,
    capturedAt,
    text,
    bytes,
    path: `highlights/${month}/${filename}`,
    redactionVersion: redacted.version,
    redactionCount: redacted.count,
  };
}
