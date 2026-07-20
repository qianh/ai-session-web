export interface TokenProvider {
  getToken(): Promise<string>;
  invalidate(token: string): Promise<void>;
}

export interface DriveHttp {
  request(
    path: string,
    init?: RequestInit,
    acceptedStatuses?: readonly number[],
  ): Promise<Response>;
  json<T>(path: string, init?: RequestInit): Promise<T>;
  bytes(path: string, init?: RequestInit): Promise<Uint8Array>;
}

export class DriveApiError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(`Google Drive request failed (${status})`);
    this.name = "DriveApiError";
  }
}

interface DriveRestClientOptions {
  tokenProvider: TokenProvider;
  fetch?: typeof globalThis.fetch;
  maxRetries?: number;
  wait?: (milliseconds: number) => Promise<void>;
}

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

const DRIVE_RATE_LIMIT_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
]);

async function isDriveRateLimit(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  try {
    const payload: unknown = await response.clone().json();
    if (!payload || typeof payload !== "object") return false;
    const error = (payload as Record<string, unknown>).error;
    if (!error || typeof error !== "object") return false;
    const errors = (error as Record<string, unknown>).errors;
    if (!Array.isArray(errors)) return false;
    return errors.some(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        DRIVE_RATE_LIMIT_REASONS.has(
          String((item as Record<string, unknown>).reason ?? ""),
        ),
    );
  } catch {
    return false;
  }
}

export class DriveRestClient implements DriveHttp {
  readonly #tokenProvider: TokenProvider;
  readonly #fetch: typeof globalThis.fetch;
  readonly #maxRetries: number;
  readonly #wait: (milliseconds: number) => Promise<void>;

  constructor(options: DriveRestClientOptions) {
    this.#tokenProvider = options.tokenProvider;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#maxRetries = options.maxRetries ?? 3;
    this.#wait = options.wait ?? defaultWait;
  }

  async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.request(path, init);
    return (await response.json()) as T;
  }

  async bytes(path: string, init: RequestInit = {}): Promise<Uint8Array> {
    const response = await this.request(path, init);
    return new Uint8Array(await response.arrayBuffer());
  }

  async request(
    path: string,
    init: RequestInit = {},
    acceptedStatuses: readonly number[] = [],
  ): Promise<Response> {
    let token = await this.#tokenProvider.getToken();
    let authRetried = false;
    let retry = 0;
    while (true) {
      const headers = new Headers(init.headers);
      headers.set("authorization", `Bearer ${token}`);
      headers.set("accept", "application/json");
      let response: Response;
      try {
        response = await this.#fetch(
          path.startsWith("https://") ? path : `${DRIVE_API_BASE}${path}`,
          { ...init, headers },
        );
      } catch (error) {
        if (retry >= this.#maxRetries) throw error;
        await this.#wait(2 ** retry * 1000);
        retry += 1;
        continue;
      }
      if (response.ok || acceptedStatuses.includes(response.status)) {
        return response;
      }
      if (response.status === 401 && !authRetried) {
        authRetried = true;
        await this.#tokenProvider.invalidate(token);
        token = await this.#tokenProvider.getToken();
        continue;
      }
      const retryable =
        retryableStatus(response.status) || (await isDriveRateLimit(response));
      if (retryable && retry < this.#maxRetries) {
        await this.#wait(2 ** retry * 1000);
        retry += 1;
        continue;
      }
      throw new DriveApiError(response.status, retryable);
    }
  }
}
