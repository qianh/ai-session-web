import type { SiteId } from "../state/store";
import type { StreamTurnCapture } from "./stream-capture";

export interface ObserverPageMessage {
  channel: "brain-capture-observer";
  version: 1;
  type: "conversation-complete";
  site: SiteId;
  capture?: StreamTurnCapture;
}

export interface ObserverPageSignal {
  site: SiteId;
  capture?: StreamTurnCapture;
}

export interface ObserverMessageEvent {
  source: unknown;
  origin: string;
  data: unknown;
}

export function createObserverMessage(
  site: SiteId,
  capture?: StreamTurnCapture,
): ObserverPageMessage {
  return {
    channel: "brain-capture-observer",
    version: 1,
    type: "conversation-complete",
    site,
    ...(capture ? { capture } : {}),
  };
}

export function parseObserverMessage(
  event: ObserverMessageEvent,
  expectedSource: unknown,
  expectedOrigin: string,
): ObserverPageSignal | undefined {
  const site = ORIGIN_SITES[expectedOrigin];
  if (
    !site ||
    event.source !== expectedSource ||
    event.origin !== expectedOrigin ||
    !isRecord(event.data)
  ) {
    return undefined;
  }
  const keys = Object.keys(event.data).sort();
  const expectedKeys = event.data.capture
    ? ["capture", "channel", "site", "type", "version"]
    : ["channel", "site", "type", "version"];
  if (
    keys.join("\0") !== expectedKeys.join("\0") ||
    event.data.channel !== "brain-capture-observer" ||
    event.data.version !== 1 ||
    event.data.type !== "conversation-complete" ||
    event.data.site !== site
  ) {
    return undefined;
  }
  if (event.data.capture === undefined) return { site };
  const capture = parseStreamTurnCapture(event.data.capture, expectedOrigin);
  return capture ? { site, capture } : undefined;
}

const ORIGIN_SITES: Record<string, SiteId | undefined> = {
  "https://chatgpt.com": "chatgpt",
  "https://claude.ai": "claude",
  "https://gemini.google.com": "gemini",
  "https://grok.com": "grok",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseStreamTurnCapture(
  value: unknown,
  expectedOrigin: string,
): StreamTurnCapture | undefined {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value).sort();
  if (
    keys.join("\0") !==
    [
      "assistantText",
      "conversationId",
      "observedAt",
      "sourceUrl",
      "userText",
    ].join("\0")
  ) {
    return undefined;
  }
  const { conversationId, userText, assistantText, observedAt, sourceUrl } =
    value;
  if (
    !boundedString(conversationId, 256) ||
    !boundedString(userText, 512 * 1024) ||
    !boundedString(assistantText, 512 * 1024) ||
    !boundedString(observedAt, 64) ||
    !boundedString(sourceUrl, 2048) ||
    Number.isNaN(Date.parse(observedAt))
  ) {
    return undefined;
  }
  try {
    if (new URL(sourceUrl).origin !== expectedOrigin) return undefined;
  } catch {
    return undefined;
  }
  return { conversationId, userText, assistantText, observedAt, sourceUrl };
}

function boundedString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}
