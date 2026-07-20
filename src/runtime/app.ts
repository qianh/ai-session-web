import {
  ChatGptAdapter,
  ClaudeAdapter,
  GeminiAdapter,
  GrokAdapter,
  type BrowserSiteAdapter,
} from "../adapters/clients";
import { isRecord } from "../adapters/shared";
import { ChromePageTransport } from "../bridge/page-transport";
import type { StreamTurnCapture } from "../bridge/stream-capture";
import { ChromeTokenProvider } from "../drive/chrome-auth";
import { GoogleDriveGateway } from "../drive/google-drive";
import { DriveRestClient } from "../drive/rest-client";
import { SessionUploadService } from "../drive/upload-service";
import { MediaArchiver } from "../media/archiver";
import { OffscreenImageConverter } from "../media/offscreen-converter";
import { DEVELOPMENT_OAUTH_CLIENT_ID } from "../platform/manifest";
import { NetworkObserverRegistration } from "../platform/network-observer-registration";
import { SitePermissionService } from "../platform/site-permissions";
import { ChromeStateStore, SITE_IDS, type SiteId } from "../state/store";
import { SyncEngine } from "../sync/engine";
import { SessionPipeline } from "../sync/pipeline";
import { SiteTaskCoordinator } from "../sync/site-task-coordinator";
import { buildStreamFallbackSession } from "../sync/stream-fallback";
import { DriveConnectionService } from "./drive-connection";
import type { DashboardData, RuntimeRequest } from "./messages";
import { NetworkObserverController } from "./network-observer-controller";

interface RuntimeChromeApi {
  identity: {
    getAuthToken(details: {
      interactive: boolean;
    }): Promise<{ token?: string }>;
    removeCachedAuthToken(details: { token: string }): Promise<void>;
  };
  runtime: {
    getManifest(): { oauth2?: { client_id?: string } };
  };
  action: {
    setBadgeText(details: { text: string }): Promise<void>;
    setBadgeBackgroundColor(details: { color: string }): Promise<void>;
  };
  scripting: {
    getRegisteredContentScripts(filter?: {
      ids?: string[];
    }): Promise<Array<Record<string, unknown>>>;
    registerContentScripts(
      scripts: Array<Record<string, unknown>>,
    ): Promise<void>;
    unregisterContentScripts(filter?: { ids?: string[] }): Promise<void>;
  };
}

export class BrainCaptureRuntime {
  readonly #chrome: RuntimeChromeApi;
  readonly #store: ChromeStateStore;
  readonly #permissions: SitePermissionService;
  readonly #transport: ChromePageTransport;
  readonly #tokenProvider: ChromeTokenProvider;
  readonly #gateway: GoogleDriveGateway;
  readonly #syncCoordinator = new SiteTaskCoordinator();
  readonly #observer: NetworkObserverController;

  constructor() {
    this.#chrome = (
      globalThis as unknown as { chrome: RuntimeChromeApi }
    ).chrome;
    this.#store = new ChromeStateStore();
    this.#permissions = new SitePermissionService();
    this.#transport = new ChromePageTransport();
    this.#tokenProvider = new ChromeTokenProvider(this.#chrome.identity);
    this.#gateway = new GoogleDriveGateway(
      new DriveRestClient({
        tokenProvider: this.#tokenProvider,
      }),
    );
    this.#observer = new NetworkObserverController({
      store: this.#store,
      permissions: this.#permissions,
      registration: new NetworkObserverRegistration(this.#chrome.scripting),
      syncSite: (site) => this.syncSite(site),
      archiveFallback: (site, capture) =>
        this.archiveStreamFallback(site, capture),
    });
  }

  async handle(request: RuntimeRequest): Promise<unknown> {
    switch (request.type) {
      case "GET_DASHBOARD":
        return this.dashboard();
      case "CONNECT_DRIVE":
        return this.connectDrive();
      case "DISCONNECT_DRIVE":
        return this.disconnectDrive();
      case "SET_SITE_ENABLED":
        return this.setSiteEnabled(request.site, request.enabled);
      case "SET_SITE_OPTIONS":
        return this.setSiteOptions(request.site, request);
      case "RESET_BACKFILL":
        return this.resetBackfill(request.site);
      case "SET_MEDIA_MAX_BYTES":
        return this.setMediaMaxBytes(request.maxBytes);
      case "SYNC_SITE":
        return this.syncSite(request.site);
      case "SYNC_ALL":
        return this.syncAll();
      case "OBSERVED_CONVERSATION_COMPLETE":
        return this.#observer.handleCompletion(request.site, request.capture);
    }
  }

  async dashboard(): Promise<DashboardData> {
    const permissionEntries = await Promise.all(
      SITE_IDS.map(
        async (site) =>
          [site, await this.#permissions.isGranted(site)] as const,
      ),
    );
    const oauthClientId = this.#chrome.runtime.getManifest().oauth2?.client_id;
    return {
      state: await this.#store.get(),
      permissions: Object.fromEntries(permissionEntries) as Record<
        SiteId,
        boolean
      >,
      oauthConfigured: Boolean(
        oauthClientId && oauthClientId !== DEVELOPMENT_OAUTH_CLIENT_ID,
      ),
    };
  }

  async connectDrive(): Promise<string> {
    const oauthClientId =
      this.#chrome.runtime.getManifest().oauth2?.client_id ?? "";
    const service = new DriveConnectionService({
      oauthClientId,
      tokenProvider: this.#tokenProvider,
      drive: this.#gateway,
      store: this.#store,
    });
    const root = await service.connect();
    await this.updateBadge();
    return root;
  }

  async disconnectDrive(): Promise<void> {
    await this.#store.update((state) => ({
      ...state,
      drive: { status: "disconnected" },
    }));
    await this.updateBadge();
  }

  async setSiteEnabled(site: SiteId, enabled: boolean): Promise<void> {
    if (enabled && !(await this.#permissions.isGranted(site))) {
      throw new RuntimeError("SITE_PERMISSION_REQUIRED");
    }
    let organizationId: string | undefined;
    const current = await this.#store.get();
    if (enabled && site === "claude" && !current.sites.claude.organizationId) {
      organizationId = await this.discoverClaudeOrganization();
    }
    if (enabled) await this.#observer.setEnabled(site, true);
    try {
      await this.#store.update((state) => ({
        ...state,
        sites: {
          ...state.sites,
          [site]: {
            ...state.sites[site],
            enabled,
            ...(organizationId ? { organizationId } : {}),
          },
        },
      }));
    } catch (error) {
      if (enabled) {
        await this.#observer.setEnabled(site, false).catch(() => undefined);
      }
      throw error;
    }
    if (!enabled) await this.#observer.setEnabled(site, false);
    await this.updateBadge();
  }

  async setSiteOptions(
    site: SiteId,
    options: {
      includeNonPersonalWorkspaces?: boolean;
      organizationId?: string;
    },
  ): Promise<void> {
    const organizationId = options.organizationId?.trim() || undefined;
    await this.#store.update((state) => {
      const current = state.sites[site];
      const scopeChanged =
        (options.includeNonPersonalWorkspaces === true &&
          !current.includeNonPersonalWorkspaces) ||
        (organizationId !== undefined &&
          organizationId !== current.organizationId);
      const updated = {
        ...current,
        ...(scopeChanged ? { fullBackfillPending: true } : {}),
        ...(options.includeNonPersonalWorkspaces === undefined
          ? {}
          : {
              includeNonPersonalWorkspaces:
                options.includeNonPersonalWorkspaces,
            }),
        ...(organizationId ? { organizationId } : {}),
      };
      if (scopeChanged) delete updated.watermark;
      return {
        ...state,
        sites: {
          ...state.sites,
          [site]: updated,
        },
      };
    });
  }

  async resetBackfill(site: SiteId): Promise<void> {
    await this.#store.update((state) => {
      const current = state.sites[site];
      const withoutWatermark = { ...current };
      delete withoutWatermark.watermark;
      return {
        ...state,
        sites: {
          ...state.sites,
          [site]: { ...withoutWatermark, fullBackfillPending: true },
        },
      };
    });
  }

  async setMediaMaxBytes(maxBytes: number): Promise<void> {
    if (
      !Number.isInteger(maxBytes) ||
      maxBytes < 1024 * 1024 ||
      maxBytes > 5 * 1024 ** 3
    ) {
      throw new RuntimeError("MEDIA_LIMIT_INVALID");
    }
    await this.#store.update((state) => ({
      ...state,
      media: { maxBytes },
    }));
  }

  async syncSite(site: SiteId): Promise<void> {
    await this.#syncCoordinator.run(site, async () => {
      try {
        await (await this.createSyncEngine()).syncSite(site);
      } finally {
        await this.updateBadge();
      }
    });
  }

  async syncAll(): Promise<void> {
    const state = await this.#store.get();
    await Promise.allSettled(
      SITE_IDS.filter((site) => state.sites[site].enabled).map((site) =>
        this.syncSite(site),
      ),
    );
    await this.updateBadge();
  }

  async reconcileObservers(): Promise<void> {
    await this.#observer.reconcile();
  }

  async recoverInterruptedSyncs(): Promise<void> {
    await this.#store.update((state) => ({
      ...state,
      status: Object.fromEntries(
        SITE_IDS.map((site) => {
          const status = state.status[site];
          return [
            site,
            status.phase === "running"
              ? {
                  ...status,
                  phase: "idle" as const,
                  errorCode: "SYNC_INTERRUPTED",
                }
              : status,
          ];
        }),
      ) as typeof state.status,
    }));
  }

  async updateBadge(): Promise<void> {
    const state = await this.#store.get();
    const statuses = SITE_IDS.filter((site) => state.sites[site].enabled).map(
      (site) => state.status[site],
    );
    const running = statuses.some((status) => status.phase === "running");
    const needsAttention = statuses.some((status) =>
      ["error", "needs-permission", "needs-tab"].includes(status.phase),
    );
    const text = running ? "..." : needsAttention ? "!" : "";
    await this.#chrome.action.setBadgeBackgroundColor({
      color: needsAttention ? "#b42318" : "#146c43",
    });
    await this.#chrome.action.setBadgeText({ text });
  }

  private async discoverClaudeOrganization(): Promise<string> {
    const result = await this.#transport.send("claude", {
      kind: "claude-context",
    });
    if (!isRecord(result) || !Array.isArray(result.organizationIds)) {
      throw new RuntimeError("CLAUDE_ORG_REQUIRED");
    }
    const organizationId = result.organizationIds.find(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    if (!organizationId) throw new RuntimeError("CLAUDE_ORG_REQUIRED");
    return organizationId;
  }

  private async createSyncEngine(): Promise<SyncEngine> {
    const state = await this.#store.get();
    if (state.drive.status !== "connected" || !state.drive.rootFolderId) {
      throw new RuntimeError("DRIVE_NOT_CONNECTED");
    }
    const drive = this.#gateway.forRoot(state.drive.rootFolderId);
    const converter = new OffscreenImageConverter();
    const media = new MediaArchiver({
      drive,
      maxBytes: state.media.maxBytes,
      convertImage: (bytes, mimeType) => converter.convert(bytes, mimeType),
      fetchMedia: (url, source, maxBytes) =>
        this.#transport.fetchMedia(
          source.replace(/-web$/u, "") as SiteId,
          url,
          maxBytes,
        ),
    });
    const adapters: Partial<Record<SiteId, BrowserSiteAdapter>> = {
      chatgpt: new ChatGptAdapter(this.#transport, state.deviceId),
      gemini: new GeminiAdapter(this.#transport, state.deviceId),
      grok: new GrokAdapter(this.#transport, state.deviceId),
    };
    const claudeOrganizationId = state.sites.claude.organizationId;
    if (claudeOrganizationId) {
      adapters.claude = new ClaudeAdapter(
        this.#transport,
        state.deviceId,
        claudeOrganizationId,
      );
    }
    return new SyncEngine({
      store: this.#store,
      adapters,
      pipeline: new SessionPipeline(media),
      uploader: new SessionUploadService({ drive }),
    });
  }

  private async archiveStreamFallback(
    site: SiteId,
    capture: StreamTurnCapture,
  ): Promise<void> {
    const state = await this.#store.get();
    if (state.drive.status !== "connected" || !state.drive.rootFolderId) {
      throw new RuntimeError("DRIVE_NOT_CONNECTED");
    }
    const session = await buildStreamFallbackSession(
      site,
      capture,
      state.deviceId,
    );
    const pipeline = new SessionPipeline({
      archive: async (input) => ({ session: input, warnings: [] }),
    });
    const result = await new SessionUploadService({
      drive: this.#gateway.forRoot(state.drive.rootFolderId),
    }).upload(await pipeline.prepare(session));
    if (result.status === "failed") throw new RuntimeError(result.errorCode);
  }
}

export class RuntimeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "RuntimeError";
  }
}

export function runtimeErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "RUNTIME_FAILED";
}
