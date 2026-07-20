import type { MediaRef } from "../domain/session";

export interface ConversationSummary {
  conversationId: string;
  title?: string;
  startedAt: string;
  updatedAt: string;
  workspaceId?: string;
}

export interface ConversationPage {
  items: ConversationSummary[];
  nextCursor?: string;
  nextGroupCursor?: string;
  globallyOrdered?: boolean;
}

export interface NormalizeContext {
  device: string;
  sourceUrl?: string;
  workspaceId?: string;
}

export class AdapterSchemaError extends Error {
  constructor(site: string, message: string) {
    super(`${site}: ${message}`);
    this.name = "AdapterSchemaError";
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireRecord(
  site: string,
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (!isRecord(value))
    throw new AdapterSchemaError(site, `${field} is not an object`);
  return value;
}

export function requireString(
  site: string,
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AdapterSchemaError(site, `${field} is not a non-empty string`);
  }
  return value;
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function toIso(value: unknown, fallback?: string): string {
  let date: Date | undefined;
  if (typeof value === "number" && Number.isFinite(value)) {
    date = new Date(value < 10_000_000_000 ? value * 1000 : value);
  } else if (typeof value === "string" && value.length > 0) {
    const numeric = Number(value);
    date =
      Number.isFinite(numeric) && /^\d+(?:\.\d+)?$/u.test(value)
        ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
        : new Date(value);
  }
  if (date && !Number.isNaN(date.valueOf())) return date.toISOString();
  if (fallback) return fallback;
  throw new AdapterSchemaError("session", "timestamp is missing or invalid");
}

export function epochPairToIso(value: unknown, fallback?: string): string {
  if (Array.isArray(value) && typeof value[0] === "number") {
    const nanos = typeof value[1] === "number" ? value[1] : 0;
    return new Date(value[0] * 1000 + nanos / 1_000_000).toISOString();
  }
  return toIso(value, fallback);
}

export function sourceList(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const url = optionalString(candidate.url);
    if (!url || seen.has(url) || !isHttpUrl(url)) continue;
    seen.add(url);
    const title = optionalString(candidate.title) ?? new URL(url).hostname;
    lines.push(`- [${escapeMarkdownLabel(title)}](${url})`);
  }
  return lines.length > 0 ? `Sources:\n${lines.join("\n")}` : "";
}

export function joinVisible(parts: Array<string | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function mediaRef(
  kind: MediaRef["kind"],
  urlValue: unknown,
  details: { name?: unknown; mimeType?: unknown; sizeBytes?: unknown } = {},
): MediaRef | undefined {
  if (typeof urlValue !== "string" || !isHttpUrl(urlValue)) return undefined;
  const ref: MediaRef = { kind, url: urlValue };
  const name = optionalString(details.name);
  const mimeType = optionalString(details.mimeType);
  if (name) ref.name = name;
  if (mimeType) ref.mimeType = mimeType;
  if (
    typeof details.sizeBytes === "number" &&
    Number.isInteger(details.sizeBytes) &&
    details.sizeBytes >= 0
  ) {
    ref.sizeBytes = details.sizeBytes;
  }
  return ref;
}

export function uniqueMedia(media: MediaRef[]): MediaRef[] {
  const seen = new Set<string>();
  return media.filter((item) => {
    const key = `${item.kind}\0${item.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeMarkdownLabel(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}
