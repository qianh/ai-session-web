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
  context: NormalizeContext & { conversationId: string },
): NormalizedSession {
  if (
    !Array.isArray(value) ||
    !Array.isArray(value[0]) ||
    !Array.isArray(value[0][0])
  ) {
    throw new AdapterSchemaError(SITE, "hNvQHb detail payload has changed");
  }
  const rawTurns = value[0] as unknown[];
  const turns: NormalizedSession["turns"] = [];
  let title: string | undefined;
  let startedAt: string | undefined;
  let updatedAt: string | undefined;

  for (const [index, candidate] of rawTurns.entries()) {
    if (!Array.isArray(candidate)) {
      throw new AdapterSchemaError(
        SITE,
        `detail turn ${index} is not an array`,
      );
    }
    const header = Array.isArray(candidate[0]) ? candidate[0] : [];
    title ??= optionalString(header[1]);
    const timestamp = epochPairToIso(candidate[4], startedAt);
    startedAt ??= timestamp;
    updatedAt = timestamp;

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
      const responseTime = Array.isArray(selected[8])
        ? selected[8][0]
        : undefined;
      if (typeof responseTime === "number")
        updatedAt = toIso(responseTime, updatedAt);
    }
  }
  if (!startedAt || !updatedAt || turns.length === 0) {
    throw new AdapterSchemaError(SITE, "detail payload has no visible turns");
  }
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
  return NormalizedSessionSchema.parse(session);
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
