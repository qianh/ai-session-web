import { SITE_IDS, type AppState, type SiteId } from "../state/store";
import { SITE_ORIGINS } from "../platform/site-permissions";
import { parseStreamTurnCapture } from "../bridge/observer-message";
import type { StreamTurnCapture } from "../bridge/stream-capture";

export type RuntimeRequest =
  | { type: "GET_DASHBOARD" }
  | { type: "CONNECT_DRIVE" }
  | { type: "DISCONNECT_DRIVE" }
  | { type: "SET_SITE_ENABLED"; site: SiteId; enabled: boolean }
  | {
      type: "SET_SITE_OPTIONS";
      site: SiteId;
      includeNonPersonalWorkspaces?: boolean;
      organizationId?: string;
    }
  | { type: "RESET_BACKFILL"; site: SiteId }
  | { type: "SET_MEDIA_MAX_BYTES"; maxBytes: number }
  | { type: "SYNC_SITE"; site: SiteId }
  | { type: "SYNC_ALL" }
  | {
      type: "OBSERVED_CONVERSATION_COMPLETE";
      site: SiteId;
      capture?: StreamTurnCapture;
    };

export interface DashboardData {
  state: AppState;
  permissions: Record<SiteId, boolean>;
  oauthConfigured: boolean;
}

export type RuntimeResponse =
  { ok: true; data?: unknown } | { ok: false; errorCode: string };

type ObservedConversationRequest = Extract<
  RuntimeRequest,
  { type: "OBSERVED_CONVERSATION_COMPLETE" }
>;

export function isTrustedObserverSender(
  request: ObservedConversationRequest,
  senderUrl: string | undefined,
): boolean {
  if (!senderUrl) return false;
  try {
    return (
      new URL(senderUrl).origin === new URL(SITE_ORIGINS[request.site]).origin
    );
  } catch {
    return false;
  }
}

export function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  if (typeof value !== "object" || value === null || !("type" in value))
    return false;
  const type = (value as { type?: unknown }).type;
  if (type === "OBSERVED_CONVERSATION_COMPLETE") {
    const site = (value as { site?: unknown }).site;
    if (typeof site !== "string" || !SITE_IDS.includes(site as SiteId)) {
      return false;
    }
    const record = value as { capture?: unknown };
    const keys = Object.keys(value).sort();
    const expectedKeys = record.capture
      ? ["capture", "site", "type"]
      : ["site", "type"];
    if (keys.join("\0") !== expectedKeys.join("\0")) return false;
    if (record.capture === undefined) return true;
    const origin = new URL(SITE_ORIGINS[site as SiteId]).origin;
    return parseStreamTurnCapture(record.capture, origin) !== undefined;
  }
  return (
    typeof type === "string" &&
    [
      "GET_DASHBOARD",
      "CONNECT_DRIVE",
      "DISCONNECT_DRIVE",
      "SET_SITE_ENABLED",
      "SET_SITE_OPTIONS",
      "RESET_BACKFILL",
      "SET_MEDIA_MAX_BYTES",
      "SYNC_SITE",
      "SYNC_ALL",
    ].includes(type)
  );
}
