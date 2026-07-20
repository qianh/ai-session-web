import { describe, expect, it, vi } from "vitest";

import { ChromePageTransport } from "../../../src/bridge/page-transport";

describe("ChromePageTransport", () => {
  it("requires optional host permission before looking for a tab", async () => {
    const api = {
      permissions: { contains: vi.fn(async () => false) },
      tabs: { query: vi.fn() },
      scripting: { executeScript: vi.fn() },
    };
    const transport = new ChromePageTransport(api);

    await expect(
      transport.send("grok", {
        kind: "site-api",
        site: "grok",
        path: "/rest/app-chat/conversations",
      }),
    ).rejects.toMatchObject({ code: "SITE_PERMISSION_REQUIRED" });
    expect(api.tabs.query).not.toHaveBeenCalled();
  });

  it("runs in the matching site tab and returns only the bridge result", async () => {
    const executeScript = vi.fn(async () => [
      {
        frameId: 0,
        result: { ok: true as const, status: 200, data: { conversations: [] } },
      },
    ]);
    const api = {
      permissions: { contains: vi.fn(async () => true) },
      tabs: { query: vi.fn(async () => [{ id: 42, active: true }]) },
      scripting: { executeScript },
    };
    const transport = new ChromePageTransport(api);

    await expect(
      transport.send("grok", {
        kind: "site-api",
        site: "grok",
        path: "/rest/app-chat/conversations",
      }),
    ).resolves.toEqual({ conversations: [] });
    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 42 }, world: "MAIN" }),
    );
  });

  it("pins every media chunk and release to the tab that started the transfer", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 11, active: true, lastAccessed: 1 },
        { id: 22, active: false, lastAccessed: 2 },
      ])
      .mockResolvedValue([
        { id: 11, active: false, lastAccessed: 1 },
        { id: 22, active: true, lastAccessed: 3 },
      ]);
    const executeScript = vi.fn(
      async (injection: {
        target: { tabId: number };
        args: [{ kind: string }];
      }) => {
        const kind = injection.args[0].kind;
        const data =
          kind === "media-start"
            ? { size: 4, mimeType: "text/plain" }
            : kind === "media-chunk"
              ? "ZGF0YQ=="
              : null;
        return [{ result: { ok: true as const, status: 200, data } }];
      },
    );
    const api = {
      permissions: { contains: vi.fn(async () => true) },
      tabs: { query },
      scripting: { executeScript },
    };
    const transport = new ChromePageTransport(api);

    const response = await transport.fetchMedia(
      "chatgpt",
      "https://chatgpt.com/backend-api/files/1",
      1024,
    );

    await expect(response.text()).resolves.toBe("data");
    expect(
      executeScript.mock.calls.map(([injection]) => injection.target.tabId),
    ).toEqual([11, 11, 11]);
    expect(query).toHaveBeenCalledOnce();
  });

  it("honors Retry-After and retries a throttled site request", async () => {
    const wait = vi.fn(async () => undefined);
    const executeScript = vi
      .fn()
      .mockResolvedValueOnce([
        {
          result: {
            ok: false as const,
            status: 429,
            errorCode: "SITE_HTTP_429",
            retryAfterMs: 2_000,
          },
        },
      ])
      .mockResolvedValueOnce([
        { result: { ok: true as const, status: 200, data: { items: [] } } },
      ]);
    const api = {
      permissions: { contains: vi.fn(async () => true) },
      tabs: { query: vi.fn(async () => [{ id: 42, active: true }]) },
      scripting: { executeScript },
    };
    const transport = new ChromePageTransport(api, { maxRetries: 1, wait });

    await expect(
      transport.send("chatgpt", {
        kind: "chatgpt-api",
        path: "/backend-api/conversations?offset=0",
      }),
    ).resolves.toEqual({ items: [] });
    expect(wait).toHaveBeenCalledWith(2_000);
    expect(executeScript).toHaveBeenCalledTimes(2);
  });

  it("uses a long cooldown when a throttled site omits Retry-After", async () => {
    const wait = vi.fn(async () => undefined);
    const executeScript = vi
      .fn()
      .mockResolvedValueOnce([
        {
          result: {
            ok: false as const,
            status: 429,
            errorCode: "SITE_HTTP_429",
          },
        },
      ])
      .mockResolvedValueOnce([
        { result: { ok: true as const, status: 200, data: { items: [] } } },
      ]);
    const api = {
      permissions: { contains: vi.fn(async () => true) },
      tabs: { query: vi.fn(async () => [{ id: 42, active: true }]) },
      scripting: { executeScript },
    };
    const transport = new ChromePageTransport(api, { maxRetries: 1, wait });

    await expect(
      transport.send("chatgpt", {
        kind: "chatgpt-api",
        path: "/backend-api/conversations?offset=0",
      }),
    ).resolves.toEqual({ items: [] });
    expect(wait).toHaveBeenCalledWith(30_000);
  });

  it("retries a transient in-page network failure", async () => {
    const wait = vi.fn(async () => undefined);
    const executeScript = vi
      .fn()
      .mockResolvedValueOnce([
        {
          result: {
            ok: false as const,
            status: 0,
            errorCode: "BRIDGE_REQUEST_FAILED",
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          result: {
            ok: true as const,
            status: 200,
            data: { conversations: [] },
          },
        },
      ]);
    const api = {
      permissions: { contains: vi.fn(async () => true) },
      tabs: { query: vi.fn(async () => [{ id: 42, active: true }]) },
      scripting: { executeScript },
    };
    const transport = new ChromePageTransport(api, { maxRetries: 1, wait });

    await expect(
      transport.send("gemini", {
        kind: "gemini-rpc",
        rpcId: "MaZiqc",
        payload: [],
      }),
    ).resolves.toEqual({ conversations: [] });
    expect(wait).toHaveBeenCalledWith(2_000);
    expect(executeScript).toHaveBeenCalledTimes(2);
  });

  it("serializes and spaces concurrent requests to the same site", async () => {
    let now = 0;
    const wait = vi.fn(async (milliseconds: number) => {
      now += milliseconds;
    });
    const executeScript = vi.fn(async () => [
      {
        result: {
          ok: true as const,
          status: 200,
          data: { conversations: [] },
        },
      },
    ]);
    const api = {
      permissions: { contains: vi.fn(async () => true) },
      tabs: { query: vi.fn(async () => [{ id: 42, active: true }]) },
      scripting: { executeScript },
    };
    const transport = new ChromePageTransport(api, {
      wait,
      now: () => now,
      minIntervalMs: { grok: 1_000 },
    });
    const request = {
      kind: "site-api" as const,
      site: "grok" as const,
      path: "/rest/app-chat/conversations",
    };

    await Promise.all([
      transport.send("grok", request),
      transport.send("grok", request),
    ]);

    expect(executeScript).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(1_000);
  });

  it("uses a conservative default interval for Gemini backfill", async () => {
    let now = 0;
    const wait = vi.fn(async (milliseconds: number) => {
      now += milliseconds;
    });
    const api = {
      permissions: { contains: vi.fn(async () => true) },
      tabs: { query: vi.fn(async () => [{ id: 42, active: true }]) },
      scripting: {
        executeScript: vi.fn(async () => [
          { result: { ok: true as const, status: 200, data: "frame" } },
        ]),
      },
    };
    const transport = new ChromePageTransport(api, {
      wait,
      now: () => now,
    });
    const request = {
      kind: "gemini-rpc" as const,
      rpcId: "MaZiqc" as const,
      payload: [],
    };

    await Promise.all([
      transport.send("gemini", request),
      transport.send("gemini", request),
    ]);

    expect(wait).toHaveBeenCalledWith(3_000);
  });

  it("retries when a matching tab reloads during script execution", async () => {
    const wait = vi.fn(async () => undefined);
    const executeScript = vi
      .fn()
      .mockRejectedValueOnce(new Error("Frame was removed"))
      .mockResolvedValueOnce([
        {
          result: {
            ok: true as const,
            status: 200,
            data: { conversations: [] },
          },
        },
      ]);
    const api = {
      permissions: { contains: vi.fn(async () => true) },
      tabs: { query: vi.fn(async () => [{ id: 42, active: true }]) },
      scripting: { executeScript },
    };
    const transport = new ChromePageTransport(api, { maxRetries: 1, wait });

    await expect(
      transport.send("grok", {
        kind: "site-api",
        site: "grok",
        path: "/rest/app-chat/conversations",
      }),
    ).resolves.toEqual({ conversations: [] });
    expect(wait).toHaveBeenCalledWith(250);
    expect(api.tabs.query).toHaveBeenCalledTimes(2);
  });
});
