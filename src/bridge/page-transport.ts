import {
  executePageRequest,
  type PageRequest,
  type PageResponse,
} from "./main-world";

export type SiteId = "chatgpt" | "claude" | "gemini" | "grok";

const SITE_PATTERNS: Record<SiteId, string> = {
  chatgpt: "https://chatgpt.com/*",
  claude: "https://claude.ai/*",
  gemini: "https://gemini.google.com/*",
  grok: "https://grok.com/*",
};

interface ChromePageApi {
  permissions: {
    contains(permissions: { origins: string[] }): Promise<boolean>;
  };
  tabs: {
    query(queryInfo: {
      url: string[];
    }): Promise<
      Array<{ id?: number; active?: boolean; lastAccessed?: number }>
    >;
  };
  scripting: {
    executeScript(injection: {
      target: { tabId: number };
      world: "MAIN";
      func: typeof executePageRequest;
      args: [PageRequest];
    }): Promise<Array<{ result?: PageResponse }>>;
  };
}

interface ChromePageTransportOptions {
  maxRetries?: number;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  minIntervalMs?: Partial<Record<SiteId, number>>;
}

const DEFAULT_MIN_INTERVAL_MS: Record<SiteId, number> = {
  chatgpt: 1_500,
  claude: 750,
  gemini: 3_000,
  grok: 750,
};

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class PageTransportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PageTransportError";
  }
}

export interface SitePageTransport {
  send(site: SiteId, request: PageRequest): Promise<unknown>;
}

export class ChromePageTransport implements SitePageTransport {
  readonly #maxRetries: number;
  readonly #wait: (milliseconds: number) => Promise<void>;
  readonly #now: () => number;
  readonly #minIntervalMs: Record<SiteId, number>;
  readonly #queues = new Map<SiteId, Promise<void>>();
  readonly #nextAllowedAt = new Map<SiteId, number>();

  constructor(
    private readonly api: ChromePageApi = (
      globalThis as unknown as { chrome: ChromePageApi }
    ).chrome,
    options: ChromePageTransportOptions = {},
  ) {
    this.#maxRetries = options.maxRetries ?? 4;
    this.#wait = options.wait ?? defaultWait;
    this.#now = options.now ?? Date.now;
    this.#minIntervalMs = {
      ...DEFAULT_MIN_INTERVAL_MS,
      ...options.minIntervalMs,
    };
  }

  async send(site: SiteId, request: PageRequest): Promise<unknown> {
    return this.#enqueue(
      site,
      async () => (await this.#execute(site, request)).data,
    );
  }

  async #enqueue<T>(site: SiteId, operation: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(site) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        const delay = (this.#nextAllowedAt.get(site) ?? 0) - this.#now();
        if (delay > 0) await this.#wait(delay);
        try {
          return await operation();
        } finally {
          this.#nextAllowedAt.set(
            site,
            this.#now() + this.#minIntervalMs[site],
          );
        }
      });
    this.#queues.set(
      site,
      current.then(
        () => undefined,
        () => undefined,
      ),
    );
    return current;
  }

  async fetchMedia(
    site: SiteId,
    url: string,
    maxBytes: number,
  ): Promise<Response> {
    const cacheKey = crypto.randomUUID();
    const tabId = await this.#selectTab(site);
    let started = false;
    try {
      const start = await this.#execute(
        site,
        {
          kind: "media-start",
          url,
          cacheKey,
          maxBytes,
        },
        tabId,
      );
      started = true;
      if (!isRecord(start.data)) {
        throw new PageTransportError(
          "BRIDGE_INVALID_MEDIA_META",
          "Media metadata is invalid",
        );
      }
      const size = start.data.size;
      const mimeType = start.data.mimeType;
      if (
        typeof size !== "number" ||
        !Number.isInteger(size) ||
        size < 0 ||
        size > maxBytes ||
        typeof mimeType !== "string"
      ) {
        throw new PageTransportError(
          "BRIDGE_INVALID_MEDIA_META",
          "Media metadata is invalid",
        );
      }
      const bytes = new Uint8Array(size);
      const chunkSize = 256 * 1024;
      for (let offset = 0; offset < size; offset += chunkSize) {
        const response = await this.#execute(
          site,
          {
            kind: "media-chunk",
            cacheKey,
            offset,
            length: Math.min(chunkSize, size - offset),
          },
          tabId,
        );
        if (typeof response.data !== "string") {
          throw new PageTransportError(
            "BRIDGE_INVALID_MEDIA_CHUNK",
            "Media chunk is invalid",
          );
        }
        const binary = atob(response.data);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[offset + index] = binary.charCodeAt(index);
        }
      }
      return new Response(bytes.buffer, {
        status: 200,
        headers: {
          "content-type": mimeType,
          "content-length": String(size),
        },
      });
    } finally {
      if (started) {
        await this.#execute(
          site,
          { kind: "media-release", cacheKey },
          tabId,
        ).catch(() => undefined);
      }
    }
  }

  async #execute(
    site: SiteId,
    request: PageRequest,
    pinnedTabId?: number,
  ): Promise<Extract<PageResponse, { ok: true }>> {
    for (let attempt = 0; ; attempt += 1) {
      const tabId = pinnedTabId ?? (await this.#selectTab(site));
      let results: Array<{ result?: PageResponse }>;
      try {
        results = await this.api.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: executePageRequest,
          args: [request],
        });
      } catch {
        if (attempt < this.#maxRetries) {
          await this.#wait(250 * 2 ** attempt);
          continue;
        }
        throw new PageTransportError(
          "BRIDGE_EXECUTION_FAILED",
          `${site} tab changed during request execution`,
        );
      }
      const response = results[0]?.result;
      if (!response) {
        throw new PageTransportError(
          "BRIDGE_EMPTY_RESULT",
          `${site} returned no bridge result`,
        );
      }
      if (!response.ok) {
        const retryable =
          response.status === 429 ||
          response.status >= 500 ||
          response.errorCode === "BRIDGE_REQUEST_FAILED";
        if (retryable && attempt < this.#maxRetries) {
          const fallbackDelay =
            response.status === 429
              ? Math.min(30_000 * 2 ** attempt, 60_000)
              : response.errorCode === "BRIDGE_REQUEST_FAILED"
                ? Math.min(2_000 * 2 ** attempt, 30_000)
                : 1000 * 2 ** attempt;
          await this.#wait(response.retryAfterMs ?? fallbackDelay);
          continue;
        }
        throw new PageTransportError(
          response.errorCode,
          `${site} request failed (${response.status})`,
        );
      }
      return response;
    }
  }

  async #selectTab(site: SiteId): Promise<number> {
    const pattern = SITE_PATTERNS[site];
    if (!(await this.api.permissions.contains({ origins: [pattern] }))) {
      throw new PageTransportError(
        "SITE_PERMISSION_REQUIRED",
        `${site} host permission has not been granted`,
      );
    }
    const tabs = await this.api.tabs.query({ url: [pattern] });
    const tab = [...tabs]
      .sort((left, right) => {
        if (left.active !== right.active) return left.active ? -1 : 1;
        return (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0);
      })
      .find((candidate) => candidate.id !== undefined);
    if (tab?.id === undefined) {
      throw new PageTransportError(
        "SITE_TAB_REQUIRED",
        `Open a logged-in ${site} tab`,
      );
    }
    return tab.id;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
