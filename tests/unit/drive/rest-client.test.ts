import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DriveApiError,
  DriveRestClient,
  type TokenProvider,
} from "../../../src/drive/rest-client";

function tokenProvider(tokens: string[]): TokenProvider & {
  invalidated: string[];
} {
  let index = 0;
  const invalidated: string[] = [];
  return {
    invalidated,
    async getToken() {
      const token = tokens[Math.min(index, tokens.length - 1)];
      index += 1;
      if (!token) throw new Error("missing test token");
      return token;
    },
    async invalidate(token) {
      invalidated.push(token);
    },
  };
}

describe("DriveRestClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("preserves the WorkerGlobalScope receiver for the default fetch", async () => {
    const workerScope = globalThis;
    const brandCheckedFetch = vi.fn(function (this: unknown) {
      if (this !== workerScope) {
        throw new TypeError(
          "Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation",
        );
      }
      return Promise.resolve(Response.json({ id: "ok" }));
    });
    vi.stubGlobal("fetch", brandCheckedFetch);
    const client = new DriveRestClient({
      tokenProvider: tokenProvider(["token-1"]),
    });

    await expect(client.json<{ id: string }>("/files")).resolves.toEqual({
      id: "ok",
    });
  });

  it("adds the OAuth token without exposing it in returned data", async () => {
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer token-1",
        );
        return Response.json({ files: [{ id: "root" }] });
      },
    );
    const client = new DriveRestClient({
      tokenProvider: tokenProvider(["token-1"]),
      fetch,
    });

    await expect(
      client.json<{ files: Array<{ id: string }> }>("/files"),
    ).resolves.toEqual({ files: [{ id: "root" }] });
  });

  it("evicts a rejected token and retries once with a fresh token", async () => {
    const provider = tokenProvider(["expired", "fresh"]);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({}, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ id: "ok" }));
    const client = new DriveRestClient({ tokenProvider: provider, fetch });

    await expect(client.json<{ id: string }>("/files/ok")).resolves.toEqual({
      id: "ok",
    });
    expect(provider.invalidated).toEqual(["expired"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("backs off on rate limits and then succeeds", async () => {
    const waits: number[] = [];
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({}, { status: 429 }))
      .mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ id: "ok" }));
    const client = new DriveRestClient({
      tokenProvider: tokenProvider(["token"]),
      fetch,
      maxRetries: 2,
      wait: async (milliseconds) => {
        waits.push(milliseconds);
      },
    });

    await expect(client.json<{ id: string }>("/files/ok")).resolves.toEqual({
      id: "ok",
    });
    expect(waits).toEqual([1000, 2000]);
  });

  it("retries a Drive 403 user rate limit response", async () => {
    const waits: number[] = [];
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              errors: [
                {
                  domain: "usageLimits",
                  reason: "userRateLimitExceeded",
                  message: "User Rate Limit Exceeded",
                },
              ],
              code: 403,
            },
          },
          { status: 403 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ id: "ok" }));
    const client = new DriveRestClient({
      tokenProvider: tokenProvider(["token"]),
      fetch,
      wait: async (milliseconds) => {
        waits.push(milliseconds);
      },
    });

    await expect(client.json<{ id: string }>("/files/ok")).resolves.toEqual({
      id: "ok",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([1000]);
  });

  it("returns a typed sanitized error after retry exhaustion", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        Response.json(
          { error: { message: "request failed for secret-token" } },
          { status: 403 },
        ),
      );
    const client = new DriveRestClient({
      tokenProvider: tokenProvider(["secret-token"]),
      fetch,
    });

    const error = await client
      .json("/files")
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DriveApiError);
    expect(error).toMatchObject({ status: 403, retryable: false });
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(error)).not.toContain("secret-token");
  });

  it("returns an authenticated 308 response when explicitly accepted", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      async () =>
        new Response(null, {
          status: 308,
          headers: { range: "bytes=0-8388607" },
        }),
    );
    const client = new DriveRestClient({
      tokenProvider: tokenProvider(["token"]),
      fetch,
    });

    const response = await client.request(
      "https://upload.example.test/session-1",
      { method: "PUT", body: new Uint8Array([1, 2, 3]) },
      [308],
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("range")).toBe("bytes=0-8388607");
    expect(
      new Headers(fetch.mock.calls[0]?.[1]?.headers).get("authorization"),
    ).toBe("Bearer token");
  });
});
