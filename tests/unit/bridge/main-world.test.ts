import { describe, expect, it, vi } from "vitest";

import { executePageRequest } from "../../../src/bridge/main-world";

describe("main-world request bridge", () => {
  it("uses a ChatGPT access token once without returning it", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: "secret-chat-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const result = await executePageRequest(
      { kind: "chatgpt-api", path: "/backend-api/conversations?offset=0" },
      {
        origin: "https://chatgpt.com",
        pathname: "/",
        language: "en",
        fetch,
        wizGlobalData: {},
      },
    );

    expect(result).toEqual({ ok: true, status: 200, data: { items: [] } });
    expect(fetch.mock.calls[1]?.[1]?.headers).toMatchObject({
      authorization: "Bearer secret-chat-token",
    });
    expect(JSON.stringify(result)).not.toContain("secret-chat-token");
  });

  it("builds Gemini batchexecute requests from in-page WIZ tokens", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response("rpc-response", { status: 200 }),
    );
    const result = await executePageRequest(
      {
        kind: "gemini-rpc",
        rpcId: "MaZiqc",
        payload: [20, null, [0, null, 1]],
      },
      {
        origin: "https://gemini.google.com",
        pathname: "/app",
        language: "zh-CN",
        fetch,
        wizGlobalData: {
          SNlM0e: "anti-csrf",
          cfb2h: "build-label",
          FdrFJe: "session-id",
        },
      },
    );

    expect(result).toEqual({ ok: true, status: 200, data: "rpc-response" });
    const requestUrl = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("rpcids")).toBe("MaZiqc");
    expect(
      new Headers(fetch.mock.calls[0]?.[1]?.headers).get("x-same-domain"),
    ).toBe("1");
    const body = new URLSearchParams(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body.get("at")).toBe("anti-csrf");
    expect(body.get("f.req")).toContain("MaZiqc");
    expect(JSON.stringify(result)).not.toContain("anti-csrf");
  });

  it("keeps Gemini batchexecute frames as text when labeled JSON", async () => {
    const body = `)]}'\n[[["wrb.fr","MaZiqc","[null,null,[]]"]]]`;
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(body, {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
    );

    await expect(
      executePageRequest(
        {
          kind: "gemini-rpc",
          rpcId: "MaZiqc",
          payload: [20, null, [0, null, 1]],
        },
        {
          origin: "https://gemini.google.com",
          pathname: "/app",
          language: "zh-CN",
          fetch,
          wizGlobalData: {
            SNlM0e: "anti-csrf",
            cfb2h: "build-label",
            FdrFJe: "session-id",
          },
        },
      ),
    ).resolves.toEqual({ ok: true, status: 200, data: body });
  });

  it("returns a bounded Retry-After delay for throttled requests", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: "secret-chat-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 429,
          headers: { "retry-after": "2" },
        }),
      );

    await expect(
      executePageRequest(
        { kind: "chatgpt-api", path: "/backend-api/conversations?offset=0" },
        {
          origin: "https://chatgpt.com",
          pathname: "/",
          language: "en",
          fetch,
          wizGlobalData: {},
        },
      ),
    ).resolves.toEqual({
      ok: false,
      status: 429,
      errorCode: "SITE_HTTP_429",
      retryAfterMs: 2_000,
    });
  });

  it("blocks cross-origin and unknown endpoints", async () => {
    const fetch = vi.fn();
    await expect(
      executePageRequest(
        { kind: "site-api", site: "grok", path: "https://evil.example/data" },
        {
          origin: "https://grok.com",
          pathname: "/",
          language: "en",
          fetch,
          wizGlobalData: {},
        },
      ),
    ).resolves.toMatchObject({ ok: false, errorCode: "BRIDGE_PATH_DENIED" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("downloads media into an ephemeral page cache and releases it", async () => {
    const mediaCache = new Map();
    const environment = {
      origin: "https://grok.com",
      pathname: "/c/test",
      language: "en",
      fetch: vi.fn<typeof globalThis.fetch>(
        async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "content-type": "image/png", "content-length": "3" },
          }),
      ),
      wizGlobalData: {},
      mediaCache,
    };

    await expect(
      executePageRequest(
        {
          kind: "media-start",
          url: "https://assets.example/image.png",
          cacheKey: "12345678-1234-1234-1234-123456789012",
          maxBytes: 1024,
        },
        environment,
      ),
    ).resolves.toEqual({
      ok: true,
      status: 200,
      data: { size: 3, mimeType: "image/png" },
    });
    await expect(
      executePageRequest(
        {
          kind: "media-chunk",
          cacheKey: "12345678-1234-1234-1234-123456789012",
          offset: 0,
          length: 3,
        },
        environment,
      ),
    ).resolves.toEqual({
      ok: true,
      status: 200,
      data: "AQID",
    });
    await executePageRequest(
      {
        kind: "media-release",
        cacheKey: "12345678-1234-1234-1234-123456789012",
      },
      environment,
    );
    expect(mediaCache.size).toBe(0);
  });

  it("discovers Claude organization IDs from page resource metadata", async () => {
    await expect(
      executePageRequest(
        { kind: "claude-context" },
        {
          origin: "https://claude.ai",
          pathname: "/new",
          language: "en",
          fetch: vi.fn(),
          wizGlobalData: {},
          resourceUrls: [
            "https://claude.ai/api/organizations/org-1/chat_conversations_v2?limit=30",
            "https://claude.ai/api/organizations/org-1/projects",
          ],
        },
      ),
    ).resolves.toEqual({
      ok: true,
      status: 200,
      data: { organizationIds: ["org-1"] },
    });
  });
});
