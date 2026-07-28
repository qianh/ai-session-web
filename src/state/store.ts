import { z } from "zod";

export const SITE_IDS = ["chatgpt", "claude", "gemini", "grok"] as const;
export type SiteId = (typeof SITE_IDS)[number];

const WatermarkSchema = z.object({
  updatedAt: z.iso.datetime({ offset: true }),
  conversationId: z.string().min(1),
});

const SiteSettingsSchema = z.object({
  enabled: z.boolean(),
  fullBackfillPending: z.boolean(),
  includeNonPersonalWorkspaces: z.boolean(),
  watermark: WatermarkSchema.optional(),
  organizationId: z.string().min(1).optional(),
});

const SiteStatusSchema = z.object({
  phase: z.enum(["idle", "running", "error", "needs-permission", "needs-tab"]),
  errorCode: z.string().min(1).optional(),
  archived: z.int().nonnegative(),
  skipped: z.int().nonnegative(),
  lastRunAt: z.iso.datetime({ offset: true }).optional(),
});

const SitesSchema = z.object({
  chatgpt: SiteSettingsSchema,
  claude: SiteSettingsSchema,
  gemini: SiteSettingsSchema,
  grok: SiteSettingsSchema,
});

const StatusSchema = z.object({
  chatgpt: SiteStatusSchema,
  claude: SiteStatusSchema,
  gemini: SiteStatusSchema,
  grok: SiteStatusSchema,
});

export const AppStateSchema = z.object({
  version: z.literal(1),
  deviceId: z.string().min(1),
  drive: z.object({
    status: z.enum(["disconnected", "connected", "error"]),
    rootFolderId: z.string().min(1).optional(),
    accountEmail: z.string().email().optional(),
    accountDisplayName: z.string().min(1).optional(),
    accountPermissionId: z.string().min(1).optional(),
    rootCandidates: z
      .array(
        z.object({
          id: z.string().min(1),
          name: z.string().min(1),
          mimeType: z.string().min(1),
        }),
      )
      .optional(),
    connectedAt: z.iso.datetime({ offset: true }).optional(),
    errorCode: z.string().min(1).optional(),
    diagnostic: z
      .object({
        stage: z.enum(["oauth", "drive-root"]),
        name: z.string().min(1).max(64),
        message: z.string().min(1).max(240),
      })
      .optional(),
  }),
  media: z.object({
    maxBytes: z
      .int()
      .positive()
      .max(5 * 1024 * 1024 * 1024),
  }),
  sites: SitesSchema,
  status: StatusSchema,
});

export type AppState = z.infer<typeof AppStateSchema>;
export type SiteSettings = AppState["sites"][SiteId];

interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface StateStore {
  get(): Promise<AppState>;
  update(mutate: (state: AppState) => AppState): Promise<AppState>;
}

const STORAGE_KEY = "brainCaptureState";
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

export function createDefaultState(deviceId: string): AppState {
  const site = () => ({
    enabled: false,
    fullBackfillPending: true,
    includeNonPersonalWorkspaces: false,
  });
  const status = () => ({ phase: "idle" as const, archived: 0, skipped: 0 });
  return {
    version: 1,
    deviceId,
    drive: { status: "disconnected" },
    media: { maxBytes: DEFAULT_MAX_BYTES },
    sites: {
      chatgpt: site(),
      claude: site(),
      gemini: site(),
      grok: site(),
    },
    status: {
      chatgpt: status(),
      claude: status(),
      gemini: status(),
      grok: status(),
    },
  };
}

export class ChromeStateStore implements StateStore {
  readonly #area: StorageArea;
  readonly #deviceId: () => string;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(
    area: StorageArea = (
      globalThis as unknown as { chrome: { storage: { local: StorageArea } } }
    ).chrome.storage.local,
    deviceId: () => string = () => `web-${crypto.randomUUID()}`,
  ) {
    this.#area = area;
    this.#deviceId = deviceId;
  }

  async get(): Promise<AppState> {
    const stored = (await this.#area.get(STORAGE_KEY))[STORAGE_KEY];
    const parsed = AppStateSchema.safeParse(stored);
    if (parsed.success) return parsed.data;
    const initial = createDefaultState(this.#deviceId());
    await this.#area.set({ [STORAGE_KEY]: initial });
    return initial;
  }

  update(mutate: (state: AppState) => AppState): Promise<AppState> {
    const operation = this.#queue.then(async () => {
      const next = AppStateSchema.parse(mutate(await this.get()));
      await this.#area.set({ [STORAGE_KEY]: next });
      return next;
    });
    this.#queue = operation.catch(() => undefined);
    return operation;
  }

  async reset(): Promise<AppState> {
    const initial = createDefaultState(this.#deviceId());
    await this.#area.set({ [STORAGE_KEY]: initial });
    return initial;
  }
}
