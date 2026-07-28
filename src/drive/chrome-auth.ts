import { DriveAuthError, type TokenProvider } from "./rest-client";

interface ChromeIdentityApi {
  getAuthToken(details: { interactive: boolean }): Promise<{ token?: string }>;
  removeCachedAuthToken(details: { token: string }): Promise<void>;
  clearAllCachedAuthTokens?(): Promise<void>;
}

export class ChromeTokenProvider implements TokenProvider {
  #token: string | undefined;

  constructor(
    readonly identity: ChromeIdentityApi,
    readonly fetcher: typeof fetch = fetch,
  ) {}

  async getToken(): Promise<string> {
    return this.#token ?? this.#request(false);
  }

  connect(): Promise<string> {
    return this.#request(true);
  }

  async invalidate(token: string): Promise<void> {
    if (this.#token === token) this.#token = undefined;
    await this.identity.removeCachedAuthToken({ token });
  }

  async disconnect(): Promise<void> {
    let token = this.#token;
    if (!token) {
      try {
        token = await this.#request(false);
      } catch {
        token = undefined;
      }
    }
    let revokeError: unknown;
    if (token) {
      try {
        const response = await this.fetcher(
          "https://oauth2.googleapis.com/revoke",
          {
            method: "POST",
            headers: {
              "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ token }),
          },
        );
        if (!response.ok) {
          throw new Error(
            `Google OAuth revocation failed with ${response.status}`,
          );
        }
      } catch (error) {
        revokeError = error;
      }
    }
    this.#token = undefined;
    const cleanup = await Promise.allSettled([
      ...(token ? [this.identity.removeCachedAuthToken({ token })] : []),
      this.identity.clearAllCachedAuthTokens?.() ?? Promise.resolve(),
    ]);
    const cleanupFailure = cleanup.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (revokeError) throw revokeError;
    if (cleanupFailure) throw cleanupFailure.reason;
  }

  async #request(interactive: boolean): Promise<string> {
    try {
      const result = await this.identity.getAuthToken({ interactive });
      if (!result.token) throw new DriveAuthError();
      this.#token = result.token;
      return result.token;
    } catch (error) {
      if (error instanceof DriveAuthError) throw error;
      throw new DriveAuthError(error);
    }
  }
}
