import type { TokenProvider } from "./rest-client";

interface ChromeIdentityApi {
  getAuthToken(details: { interactive: boolean }): Promise<{ token?: string }>;
  removeCachedAuthToken(details: { token: string }): Promise<void>;
}

export class ChromeTokenProvider implements TokenProvider {
  #token: string | undefined;

  constructor(readonly identity: ChromeIdentityApi) {}

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

  async #request(interactive: boolean): Promise<string> {
    const result = await this.identity.getAuthToken({ interactive });
    if (!result.token)
      throw new Error("Google Drive authorization is required");
    this.#token = result.token;
    return result.token;
  }
}
