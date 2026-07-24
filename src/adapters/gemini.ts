import {
  NormalizedSessionSchema,
  type NormalizedSession,
} from "../domain/session";
import {
  AdapterSchemaError,
  type ConversationPage,
  type NormalizeContext,
  epochPairToIso,
  optionalString,
  requireString,
  toIso,
} from "./shared";

const SITE = "gemini";

export function decodeGeminiBatchResponse(raw: string, rpcId: string): unknown {
  const cleaned = raw.replace(/^\)\]\}'\s*/u, "").trim();
  const parsedLines: unknown[] = [];
  for (const line of cleaned.split("\n")) {
    const candidate = line.trim();
    if (!candidate.startsWith("[")) continue;
    try {
      parsedLines.push(JSON.parse(candidate));
    } catch {
      // Length-prefixed batchexecute frames can leave a numeric line before JSON.
    }
  }
  for (const parsed of parsedLines) {
    const tuple = findRpcTuple(parsed, rpcId);
    if (tuple && typeof tuple[2] === "string") {
      try {
        return JSON.parse(tuple[2]);
      } catch {
        throw new AdapterSchemaError(SITE, `${rpcId} payload is not JSON`);
      }
    }
  }
  throw new AdapterSchemaError(SITE, `${rpcId} response tuple was not found`);
}

export function parseGeminiListPayload(value: unknown): ConversationPage {
  if (!Array.isArray(value) || !Array.isArray(value[2])) {
    throw new AdapterSchemaError(SITE, "MaZiqc list payload has changed");
  }
  const items = value[2].map((candidate, index) => {
    if (!Array.isArray(candidate)) {
      throw new AdapterSchemaError(SITE, `list row ${index} is not an array`);
    }
    const startedAt = epochPairToIso(candidate[5]);
    const summary = {
      conversationId: requireString(SITE, candidate[0], `list row ${index} id`),
      startedAt,
      updatedAt: toIso(candidate[9], startedAt),
    } as ConversationPage["items"][number];
    const title = optionalString(candidate[1]);
    if (title) summary.title = title;
    return summary;
  });
  const cursor = optionalString(value[1]);
  return cursor ? { items, nextCursor: cursor } : { items };
}

export function normalizeGeminiConversation(
  value: unknown,
  context: NormalizeContext & {
    conversationId: string;
    startedAt?: string;
    updatedAt?: string;
  },
): NormalizedSession | undefined {
  if (!Array.isArray(value) || !Array.isArray(value[0])) {
    throw new AdapterSchemaError(SITE, "hNvQHb detail payload has changed");
  }
  const rawTurns = value[0] as unknown[];
  // Empty conversation (no turns yet) — skip rather than fail the whole site.
  if (rawTurns.length === 0) return undefined;
  // Require at least one turn-shaped row so totally foreign payloads still fail.
  if (!rawTurns.some((row) => Array.isArray(row))) {
    throw new AdapterSchemaError(SITE, "hNvQHb detail payload has changed");
  }

  const turns: NormalizedSession["turns"] = [];
  let title: string | undefined;
  let startedAt: string | undefined;
  let updatedAt: string | undefined;

  for (const candidate of rawTurns) {
    // Soft-skip malformed turns so one odd branch does not kill the conversation.
    if (!Array.isArray(candidate)) continue;
    const header = Array.isArray(candidate[0]) ? candidate[0] : [];
    title ??= optionalString(header[1]);
    try {
      const timestamp = epochPairToIso(candidate[4], startedAt);
      startedAt ??= timestamp;
      updatedAt = laterIso(updatedAt, timestamp);
    } catch {
      // Keep going; list watermark times can fill in below if needed.
    }

    const user = Array.isArray(candidate[2]) ? candidate[2] : [];
    const userText = textFromUnknown(user[0]);
    if (userText) turns.push({ role: "user", text: userText, media: [] });

    const response = Array.isArray(candidate[3]) ? candidate[3] : [];
    const candidates = Array.isArray(response[0]) ? response[0] : [];
    const selectedId = optionalString(response[3]);
    const selected =
      candidates.find(
        (item) =>
          Array.isArray(item) &&
          selectedId !== undefined &&
          item[0] === selectedId,
      ) ?? candidates[0];
    if (Array.isArray(selected)) {
      const assistantText = textFromUnknown(selected[1]);
      if (assistantText)
        turns.push({ role: "assistant", text: assistantText, media: [] });
      // selected[8][0] is expected to be a unix timestamp; Gemini sometimes
      // puts non-time numbers here. Only accept values that do not move
      // updatedAt before startedAt (which would fail Zod refine).
      const responseTime = Array.isArray(selected[8])
        ? selected[8][0]
        : undefined;
      if (typeof responseTime === "number" && Number.isFinite(responseTime)) {
        try {
          const candidateTime = toIso(responseTime);
          updatedAt = laterIso(updatedAt, candidateTime);
        } catch {
          // Ignore unusable response timestamps.
        }
      }
    }
  }

  if (turns.length === 0) {
    throw new AdapterSchemaError(SITE, "detail payload has no visible turns");
  }
  // Prefer turn times; fall back to list summary times if turn stamps were
  // missing or unusable.
  startedAt ??= context.startedAt;
  updatedAt =
    laterIso(updatedAt, context.updatedAt) ??
    laterIso(updatedAt, startedAt) ??
    startedAt;
  if (!startedAt || !updatedAt) {
    throw new AdapterSchemaError(
      SITE,
      "detail payload has no usable timestamps",
    );
  }
  if (updatedAt < startedAt) updatedAt = startedAt;

  const session: NormalizedSession = {
    source: "gemini-web",
    conversationId: context.conversationId,
    device: context.device,
    startedAt,
    updatedAt,
    turns,
    warnings: [],
  };
  if (title) session.title = title;
  if (context.workspaceId) session.workspaceId = context.workspaceId;
  if (context.sourceUrl) session.sourceUrl = context.sourceUrl;
  try {
    return NormalizedSessionSchema.parse(session);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "session validation failed";
    throw new AdapterSchemaError(SITE, message);
  }
}

/** Prefer the chronologically later ISO timestamp. */
function laterIso(
  current: string | undefined,
  candidate: string | undefined,
): string | undefined {
  if (!candidate) return current;
  if (!current) return candidate;
  return candidate >= current ? candidate : current;
}

function findRpcTuple(value: unknown, rpcId: string): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value[0] === "wrb.fr" && value[1] === rpcId) return value;
  for (const child of value) {
    const found = findRpcTuple(child, rpcId);
    if (found) return found;
  }
  return undefined;
}

function textFromUnknown(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => textFromUnknown(part))
    .filter(Boolean)
    .join("\n\n");
}
