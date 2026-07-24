import type { BrowserSiteAdapter } from "../adapters/clients";
import {
  AdapterSchemaError,
  type ConversationSummary,
} from "../adapters/shared";
import { PageTransportError } from "../bridge/page-transport";
import { DriveApiError, DriveAuthError } from "../drive/rest-client";
import type {
  SessionUploadService,
  UploadResult,
} from "../drive/upload-service";
import type { AppState, SiteId, StateStore } from "../state/store";
import type { SessionPreparePort } from "./pipeline";

interface UploadPort {
  upload: SessionUploadService["upload"];
}

interface SyncEngineOptions {
  store: StateStore;
  adapters: Partial<Record<SiteId, BrowserSiteAdapter>>;
  pipeline: SessionPreparePort;
  uploader: UploadPort;
  now?: () => Date;
  wait?: (milliseconds: number) => Promise<void>;
  detailMaxRetries?: number;
}

type SyncStage = "state" | "list" | "detail" | "prepare" | "upload";

const MAX_CONSECUTIVE_ITEM_FAILURES = 5;

export class SyncEngine {
  readonly #store: StateStore;
  readonly #adapters: Partial<Record<SiteId, BrowserSiteAdapter>>;
  readonly #pipeline: SessionPreparePort;
  readonly #uploader: UploadPort;
  readonly #now: () => Date;
  readonly #wait: (milliseconds: number) => Promise<void>;
  readonly #detailMaxRetries: number;
  readonly #running = new Set<SiteId>();

  constructor(options: SyncEngineOptions) {
    this.#store = options.store;
    this.#adapters = options.adapters;
    this.#pipeline = options.pipeline;
    this.#uploader = options.uploader;
    this.#now = options.now ?? (() => new Date());
    this.#wait =
      options.wait ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#detailMaxRetries = options.detailMaxRetries ?? 1;
  }

  async syncSite(site: SiteId): Promise<void> {
    if (this.#running.has(site)) return;
    this.#running.add(site);
    let archived = 0;
    let skipped = 0;
    let completedItems = 0;
    let consecutiveItemFailures = 0;
    let firstItemErrorCode: string | undefined;
    let stage: SyncStage = "state";
    const runAt = this.#now().toISOString();
    try {
      const initial = await this.#store.get();
      const settings = initial.sites[site];
      if (!settings.enabled) return;
      const adapter = this.#adapters[site];
      if (!adapter) throw new SyncError("SITE_NOT_CONFIGURED");
      await this.#store.update((state) =>
        withStatus(state, site, {
          phase: "running",
          archived: 0,
          skipped: 0,
          lastRunAt: runAt,
        }),
      );

      let cursor: string | undefined;
      let highest: ConversationSummary | undefined;
      const seenConversationIds = new Set<string>();
      do {
        stage = "list";
        const page = await adapter.listPage(cursor);
        let nextCursor = page.nextCursor;
        for (const summary of page.items) {
          highest = laterSummary(highest, summary);
          if (
            !settings.fullBackfillPending &&
            settings.watermark &&
            summary.updatedAt < settings.watermark.updatedAt
          ) {
            nextCursor = page.nextGroupCursor;
            break;
          }
          if (seenConversationIds.has(summary.conversationId)) continue;
          seenConversationIds.add(summary.conversationId);
          if (summary.workspaceId && !settings.includeNonPersonalWorkspaces) {
            skipped += 1;
            completedItems += 1;
            consecutiveItemFailures = 0;
            stage = "state";
            await this.#persistProgress(site, archived, skipped, runAt);
            continue;
          }
          let prepared:
            Awaited<ReturnType<SessionPreparePort["prepare"]>> | undefined;
          try {
            stage = "detail";
            const session = await this.#getConversation(adapter, summary);
            if (session) {
              stage = "prepare";
              prepared = await this.#pipeline.prepare(session);
            }
          } catch (error) {
            if (!isSkippableItemFailure(error)) throw error;
            skipped += 1;
            consecutiveItemFailures += 1;
            firstItemErrorCode ??= classifyError(error, stage);
            stage = "state";
            await this.#persistProgress(site, archived, skipped, runAt);
            if (consecutiveItemFailures >= MAX_CONSECUTIVE_ITEM_FAILURES) {
              throw new SyncError(firstItemErrorCode);
            }
            continue;
          }
          if (!prepared) {
            skipped += 1;
            completedItems += 1;
            consecutiveItemFailures = 0;
            stage = "state";
            await this.#persistProgress(site, archived, skipped, runAt);
            continue;
          }
          stage = "upload";
          const result: UploadResult = await this.#uploader.upload(prepared);
          if (result.status === "failed") throw new SyncError(result.errorCode);
          if (result.status === "uploaded") archived += 1;
          else skipped += 1;
          completedItems += 1;
          consecutiveItemFailures = 0;
          stage = "state";
          await this.#persistProgress(site, archived, skipped, runAt);
        }
        cursor = nextCursor;
      } while (cursor);

      if (completedItems === 0 && firstItemErrorCode) {
        throw new SyncError(firstItemErrorCode);
      }

      stage = "state";
      await this.#store.update((state) => {
        const current = state.sites[site];
        const watermark =
          highest &&
          (!current.watermark || isAfterWatermark(highest, current.watermark))
            ? {
                updatedAt: highest.updatedAt,
                conversationId: highest.conversationId,
              }
            : current.watermark;
        return {
          ...withStatus(state, site, {
            phase: "idle",
            archived,
            skipped,
            lastRunAt: runAt,
          }),
          sites: {
            ...state.sites,
            [site]: {
              ...current,
              fullBackfillPending: false,
              ...(watermark ? { watermark } : {}),
            },
          },
        };
      });
    } catch (error) {
      const errorCode = classifyError(error, stage);
      await this.#store.update((state) => {
        const next = withStatus(state, site, {
          phase:
            errorCode === "SITE_PERMISSION_REQUIRED"
              ? "needs-permission"
              : errorCode === "SITE_TAB_REQUIRED"
                ? "needs-tab"
                : "error",
          errorCode,
          archived,
          skipped,
          lastRunAt: runAt,
        });
        return error instanceof DriveAuthError
          ? {
              ...next,
              drive: {
                ...next.drive,
                status: "error",
                errorCode: error.code,
              },
            }
          : next;
      });
      throw error;
    } finally {
      this.#running.delete(site);
    }
  }

  async syncEnabled(): Promise<void> {
    const state = await this.#store.get();
    await Promise.allSettled(
      (Object.keys(state.sites) as SiteId[])
        .filter((site) => state.sites[site].enabled)
        .map((site) => this.syncSite(site)),
    );
  }

  async #getConversation(
    adapter: BrowserSiteAdapter,
    summary: ConversationSummary,
  ) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await adapter.getConversation(summary);
      } catch (error) {
        if (
          !(error instanceof AdapterSchemaError) ||
          attempt >= this.#detailMaxRetries
        ) {
          throw error;
        }
        await this.#wait(Math.min(2_000 * 2 ** attempt, 10_000));
      }
    }
  }

  async #persistProgress(
    site: SiteId,
    archived: number,
    skipped: number,
    runAt: string,
  ): Promise<void> {
    await this.#store.update((state) =>
      withStatus(state, site, {
        phase: "running",
        archived,
        skipped,
        lastRunAt: runAt,
      }),
    );
  }
}

class SyncError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function isAfterWatermark(
  summary: ConversationSummary,
  watermark: { updatedAt: string; conversationId: string },
): boolean {
  return (
    summary.updatedAt > watermark.updatedAt ||
    (summary.updatedAt === watermark.updatedAt &&
      summary.conversationId > watermark.conversationId)
  );
}

function laterSummary(
  current: ConversationSummary | undefined,
  candidate: ConversationSummary,
): ConversationSummary {
  if (!current) return candidate;
  return isAfterWatermark(candidate, {
    updatedAt: current.updatedAt,
    conversationId: current.conversationId,
  })
    ? candidate
    : current;
}

function classifyError(error: unknown, stage: SyncStage = "state"): string {
  if (error instanceof PageTransportError || error instanceof SyncError)
    return error.code;
  if (error instanceof AdapterSchemaError) return "SITE_SCHEMA_CHANGED";
  if (error instanceof DriveAuthError) return error.code;
  if (error instanceof DriveApiError) {
    if (error.retryable) return "DRIVE_RATE_LIMITED";
    if (error.status === 403) return "DRIVE_PERMISSION_DENIED";
    return "DRIVE_NETWORK_FAILED";
  }
  const stageCodes: Record<SyncStage, string> = {
    state: "SYNC_STATE_FAILED",
    list: "SITE_LIST_FAILED",
    detail: "SITE_DETAIL_FAILED",
    prepare: "SESSION_PREPARE_FAILED",
    upload: "DRIVE_WRITE_FAILED",
  };
  return stageCodes[stage];
}

function isSkippableItemFailure(error: unknown): boolean {
  if (error instanceof AdapterSchemaError) return true;
  if (error instanceof DriveApiError || error instanceof SyncError)
    return false;
  if (error instanceof PageTransportError) {
    return [
      "SITE_HTTP_400",
      "SITE_HTTP_403",
      "SITE_HTTP_404",
      "SITE_HTTP_410",
      "BRIDGE_INVALID_JSON",
    ].includes(error.code);
  }
  return true;
}

function withStatus(
  state: AppState,
  site: SiteId,
  status: AppState["status"][SiteId],
): AppState {
  return {
    ...state,
    status: { ...state.status, [site]: status },
  };
}
