import type { SiteId } from "../state/store";
import {
  parseObserverMessage,
  type ObserverMessageEvent,
} from "./observer-message";
import type { StreamTurnCapture } from "./stream-capture";

export interface ObservedConversationMessage {
  type: "OBSERVED_CONVERSATION_COMPLETE";
  site: SiteId;
  capture?: StreamTurnCapture;
}

interface ObserverRelayOptions {
  source: unknown;
  origin: string;
  send(message: ObservedConversationMessage): unknown;
  now?: () => number;
  minimumIntervalMs?: number;
}

export function createObserverRelay(
  options: ObserverRelayOptions,
): (event: ObserverMessageEvent) => boolean {
  const now = options.now ?? (() => Date.now());
  const minimumIntervalMs = options.minimumIntervalMs ?? 2_500;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  return (event) => {
    const signal = parseObserverMessage(event, options.source, options.origin);
    if (!signal) return false;
    const currentTime = now();
    if (currentTime - lastSentAt < minimumIntervalMs) return false;
    lastSentAt = currentTime;
    try {
      void Promise.resolve(
        options.send({ type: "OBSERVED_CONVERSATION_COMPLETE", ...signal }),
      ).catch(() => undefined);
    } catch {
      // The page must not observe extension runtime failures.
    }
    return true;
  };
}
