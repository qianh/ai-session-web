import type { StreamTurnCapture } from "../bridge/stream-capture";
import { sha256Hex } from "../domain/hash";
import {
  NormalizedSessionSchema,
  type NormalizedSession,
  type WebSessionSource,
} from "../domain/session";
import type { SiteId } from "../state/store";

const SITE_SOURCES: Record<SiteId, WebSessionSource> = {
  chatgpt: "chatgpt-web",
  claude: "claude-web",
  gemini: "gemini-web",
  grok: "grok-web",
};

export async function buildStreamFallbackSession(
  site: SiteId,
  capture: StreamTurnCapture,
  device: string,
): Promise<NormalizedSession> {
  const source = SITE_SOURCES[site];
  const captureHash = await sha256Hex(
    JSON.stringify([
      source,
      capture.conversationId,
      capture.userText,
      capture.assistantText,
    ]),
  );
  return NormalizedSessionSchema.parse({
    source,
    conversationId: `${captureHash}-stream`,
    device,
    title: `Partial stream capture: ${capture.conversationId}`,
    sourceUrl: capture.sourceUrl,
    startedAt: capture.observedAt,
    updatedAt: capture.observedAt,
    turns: [
      { role: "user", text: capture.userText, media: [] },
      { role: "assistant", text: capture.assistantText, media: [] },
    ],
    warnings: ["STREAM_FALLBACK_PARTIAL"],
  });
}
