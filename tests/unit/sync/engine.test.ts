import { describe, expect, it, vi } from "vitest";

import type { BrowserSiteAdapter } from "../../../src/adapters/clients";
import { AdapterSchemaError } from "../../../src/adapters/shared";
import { DriveApiError } from "../../../src/drive/rest-client";
import { createDefaultState } from "../../../src/state/store";
import { SyncEngine } from "../../../src/sync/engine";

function summary(id: string, updatedAt: string, workspaceId?: string) {
  return {
    conversationId: id,
    startedAt: "2026-07-19T01:00:00.000Z",
    updatedAt,
    ...(workspaceId ? { workspaceId } : {}),
  };
}

describe("SyncEngine", () => {
  it("fully backfills pages, skips non-personal workspaces, then advances one watermark", async () => {
    let state = createDefaultState("device-test");
    state.sites.grok.enabled = true;
    const store = {
      get: vi.fn(async () => structuredClone(state)),
      update: vi.fn(async (mutate) => {
        state = mutate(structuredClone(state));
        return structuredClone(state);
      }),
    };
    const listPage = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          summary("new", "2026-07-19T03:00:00.000Z"),
          summary("team", "2026-07-19T02:30:00.000Z", "workspace-1"),
        ],
        nextCursor: "next",
      })
      .mockResolvedValueOnce({
        items: [summary("old", "2026-07-19T02:00:00.000Z")],
      });
    const getConversation = vi.fn(async (item) => ({
      source: "grok-web" as const,
      conversationId: item.conversationId,
      device: "device-test",
      startedAt: item.startedAt,
      updatedAt: item.updatedAt,
      turns: [{ role: "user" as const, text: item.conversationId, media: [] }],
      warnings: [],
    }));
    const adapter = {
      source: "grok-web" as const,
      listPage,
      getConversation,
    } satisfies BrowserSiteAdapter;
    const prepare = vi.fn(async (session) => ({
      session,
      markdown: session.conversationId,
      contentSha256: "a".repeat(64),
    }));
    const upload = vi.fn(async () => ({
      status: "uploaded" as const,
      driveFileId: "file",
    }));
    const engine = new SyncEngine({
      store,
      adapters: { grok: adapter },
      pipeline: { prepare },
      uploader: { upload },
      now: () => new Date("2026-07-19T04:00:00.000Z"),
    });

    await engine.syncSite("grok");

    expect(listPage).toHaveBeenNthCalledWith(1, undefined);
    expect(listPage).toHaveBeenNthCalledWith(2, "next");
    expect(
      getConversation.mock.calls.map(([item]) => item.conversationId),
    ).toEqual(["new", "old"]);
    expect(state.sites.grok.fullBackfillPending).toBe(false);
    expect(state.sites.grok.watermark).toEqual({
      updatedAt: "2026-07-19T03:00:00.000Z",
      conversationId: "new",
    });
    expect(state.status.grok).toMatchObject({
      phase: "idle",
      archived: 2,
      skipped: 1,
      lastRunAt: "2026-07-19T04:00:00.000Z",
    });
  });

  it("does not advance the watermark after a failed batch", async () => {
    let state = createDefaultState("device-test");
    state.sites.grok.enabled = true;
    const store = {
      get: vi.fn(async () => structuredClone(state)),
      update: vi.fn(async (mutate) => {
        state = mutate(structuredClone(state));
        return structuredClone(state);
      }),
    };
    const adapter = {
      source: "grok-web" as const,
      listPage: vi.fn(async () => ({
        items: [summary("broken", "2026-07-19T03:00:00.000Z")],
      })),
      getConversation: vi.fn(async () => {
        throw new Error("body must never be persisted");
      }),
    } satisfies BrowserSiteAdapter;
    const engine = new SyncEngine({
      store,
      adapters: { grok: adapter },
      pipeline: { prepare: vi.fn() },
      uploader: { upload: vi.fn() },
      now: () => new Date("2026-07-19T04:00:00.000Z"),
    });

    await expect(engine.syncSite("grok")).rejects.toThrow();
    expect(state.sites.grok.watermark).toBeUndefined();
    expect(state.sites.grok.fullBackfillPending).toBe(true);
    expect(state.status.grok).toEqual({
      phase: "error",
      errorCode: "SITE_DETAIL_FAILED",
      archived: 0,
      skipped: 1,
      lastRunAt: "2026-07-19T04:00:00.000Z",
    });
    expect(JSON.stringify(state)).not.toContain("body must never be persisted");
  });

  it("skips one broken conversation and continues the remaining backfill", async () => {
    let state = createDefaultState("device-test");
    state.sites.grok.enabled = true;
    const store = {
      get: vi.fn(async () => structuredClone(state)),
      update: vi.fn(async (mutate) => {
        state = mutate(structuredClone(state));
        return structuredClone(state);
      }),
    };
    const getConversation = vi.fn(async (item) => {
      if (item.conversationId === "broken") {
        throw new Error("one historical response is unavailable");
      }
      return {
        source: "grok-web" as const,
        conversationId: item.conversationId,
        device: "device-test",
        startedAt: item.startedAt,
        updatedAt: item.updatedAt,
        turns: [{ role: "user" as const, text: "ok", media: [] }],
        warnings: [],
      };
    });
    const upload = vi.fn(async () => ({
      status: "uploaded" as const,
      driveFileId: "file",
    }));
    const engine = new SyncEngine({
      store,
      adapters: {
        grok: {
          source: "grok-web",
          listPage: vi.fn(async () => ({
            items: [
              summary("broken", "2026-07-19T03:00:00.000Z"),
              summary("good", "2026-07-19T02:00:00.000Z"),
            ],
          })),
          getConversation,
        },
      },
      pipeline: {
        prepare: vi.fn(async (session) => ({
          session,
          markdown: "ok",
          contentSha256: "f".repeat(64),
        })),
      },
      uploader: { upload },
    });

    await expect(engine.syncSite("grok")).resolves.toBeUndefined();
    expect(upload).toHaveBeenCalledOnce();
    expect(state.status.grok).toMatchObject({
      phase: "idle",
      archived: 1,
      skipped: 1,
    });
    expect(state.sites.grok.fullBackfillPending).toBe(false);
  });

  it("identifies a list failure instead of reporting an internal error", async () => {
    let state = createDefaultState("device-test");
    state.sites.grok.enabled = true;
    const store = {
      get: vi.fn(async () => structuredClone(state)),
      update: vi.fn(async (mutate) => {
        state = mutate(structuredClone(state));
        return structuredClone(state);
      }),
    };
    const engine = new SyncEngine({
      store,
      adapters: {
        grok: {
          source: "grok-web",
          listPage: vi.fn(async () => {
            throw new Error("list failed");
          }),
          getConversation: vi.fn(),
        },
      },
      pipeline: { prepare: vi.fn() },
      uploader: { upload: vi.fn() },
    });

    await expect(engine.syncSite("grok")).rejects.toThrow();
    expect(state.status.grok).toMatchObject({
      phase: "error",
      errorCode: "SITE_LIST_FAILED",
    });
  });

  it("reports an exhausted Drive rate limit without hiding it as an internal error", async () => {
    let state = createDefaultState("device-test");
    state.sites.grok.enabled = true;
    const store = {
      get: vi.fn(async () => structuredClone(state)),
      update: vi.fn(async (mutate) => {
        state = mutate(structuredClone(state));
        return structuredClone(state);
      }),
    };
    const engine = new SyncEngine({
      store,
      adapters: {
        grok: {
          source: "grok-web",
          listPage: vi.fn(async () => {
            throw new DriveApiError(403, true);
          }),
          getConversation: vi.fn(),
        },
      },
      pipeline: { prepare: vi.fn() },
      uploader: { upload: vi.fn() },
    });

    await expect(engine.syncSite("grok")).rejects.toThrow(DriveApiError);
    expect(state.status.grok).toMatchObject({
      phase: "error",
      errorCode: "DRIVE_RATE_LIMITED",
    });
  });

  it("skips an empty conversation without aborting the backfill", async () => {
    let state = createDefaultState("device-test");
    state.sites.claude.enabled = true;
    const store = {
      get: vi.fn(async () => structuredClone(state)),
      update: vi.fn(async (mutate) => {
        state = mutate(structuredClone(state));
        return structuredClone(state);
      }),
    };
    const prepare = vi.fn(async () => {
      throw new Error("empty conversations must not enter the pipeline");
    });
    const upload = vi.fn();
    const engine = new SyncEngine({
      store,
      adapters: {
        claude: {
          source: "claude-web",
          listPage: vi.fn(async () => ({
            items: [summary("empty", "2026-07-19T03:00:00.000Z")],
          })),
          getConversation: vi.fn(async () => undefined),
        },
      },
      pipeline: { prepare },
      uploader: { upload },
      now: () => new Date("2026-07-19T04:00:00.000Z"),
    });

    await expect(engine.syncSite("claude")).resolves.toBeUndefined();

    expect(prepare).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(state.sites.claude.fullBackfillPending).toBe(false);
    expect(state.status.claude).toMatchObject({
      phase: "idle",
      archived: 0,
      skipped: 1,
    });
  });

  it("retries a transient detail schema failure before failing the site", async () => {
    let state = createDefaultState("device-test");
    state.sites.grok.enabled = true;
    const store = {
      get: vi.fn(async () => structuredClone(state)),
      update: vi.fn(async (mutate) => {
        state = mutate(structuredClone(state));
        return structuredClone(state);
      }),
    };
    const getConversation = vi
      .fn()
      .mockRejectedValueOnce(
        new AdapterSchemaError("grok", "response tree was incomplete"),
      )
      .mockResolvedValueOnce({
        source: "grok-web" as const,
        conversationId: "retry-me",
        device: "device-test",
        startedAt: "2026-07-19T01:00:00.000Z",
        updatedAt: "2026-07-19T03:00:00.000Z",
        turns: [{ role: "user" as const, text: "hello", media: [] }],
        warnings: [],
      });
    const wait = vi.fn(async () => undefined);
    const engine = new SyncEngine({
      store,
      adapters: {
        grok: {
          source: "grok-web",
          listPage: vi.fn(async () => ({
            items: [summary("retry-me", "2026-07-19T03:00:00.000Z")],
          })),
          getConversation,
        },
      },
      pipeline: {
        prepare: vi.fn(async (session) => ({
          session,
          markdown: "ok",
          contentSha256: "c".repeat(64),
        })),
      },
      uploader: {
        upload: vi.fn(async () => ({
          status: "uploaded" as const,
          driveFileId: "file",
        })),
      },
      wait,
      detailMaxRetries: 1,
    });

    await expect(engine.syncSite("grok")).resolves.toBeUndefined();
    expect(getConversation).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(2_000);
    expect(state.status.grok.phase).toBe("idle");
  });

  it("persists running progress after each processed conversation", async () => {
    let state = createDefaultState("device-test");
    state.sites.grok.enabled = true;
    const snapshots: Array<(typeof state.status)["grok"]> = [];
    const store = {
      get: vi.fn(async () => structuredClone(state)),
      update: vi.fn(async (mutate) => {
        state = mutate(structuredClone(state));
        snapshots.push(structuredClone(state.status.grok));
        return structuredClone(state);
      }),
    };
    const engine = new SyncEngine({
      store,
      adapters: {
        grok: {
          source: "grok-web",
          listPage: vi.fn(async () => ({
            items: [summary("one", "2026-07-19T03:00:00.000Z")],
          })),
          getConversation: vi.fn(async (item) => ({
            source: "grok-web" as const,
            conversationId: item.conversationId,
            device: "device-test",
            startedAt: item.startedAt,
            updatedAt: item.updatedAt,
            turns: [{ role: "user" as const, text: "one", media: [] }],
            warnings: [],
          })),
        },
      },
      pipeline: {
        prepare: vi.fn(async (session) => ({
          session,
          markdown: "one",
          contentSha256: "d".repeat(64),
        })),
      },
      uploader: {
        upload: vi.fn(async () => ({
          status: "uploaded" as const,
          driveFileId: "file",
        })),
      },
    });

    await engine.syncSite("grok");

    expect(snapshots).toContainEqual(
      expect.objectContaining({ phase: "running", archived: 1, skipped: 0 }),
    );
  });

  it("stops an old ordered group and continues at the next filter group", async () => {
    let state = createDefaultState("device-test");
    state.sites.chatgpt.enabled = true;
    state.sites.chatgpt.fullBackfillPending = false;
    state.sites.chatgpt.watermark = {
      updatedAt: "2026-07-19T02:00:00.000Z",
      conversationId: "watermark",
    };
    const store = {
      get: vi.fn(async () => structuredClone(state)),
      update: vi.fn(async (mutate) => {
        state = mutate(structuredClone(state));
        return structuredClone(state);
      }),
    };
    const listPage = vi
      .fn()
      .mockResolvedValueOnce({
        items: [summary("old", "2026-07-19T01:00:00.000Z")],
        nextCursor: "old-page-2",
        nextGroupCursor: "starred",
        globallyOrdered: false,
      })
      .mockResolvedValueOnce({
        items: [summary("new-starred", "2026-07-19T03:00:00.000Z")],
        globallyOrdered: false,
      });
    const getConversation = vi.fn(async (item) => ({
      source: "chatgpt-web" as const,
      conversationId: item.conversationId,
      device: "device-test",
      startedAt: item.startedAt,
      updatedAt: item.updatedAt,
      turns: [{ role: "user" as const, text: item.conversationId, media: [] }],
      warnings: [],
    }));
    const engine = new SyncEngine({
      store,
      adapters: {
        chatgpt: {
          source: "chatgpt-web",
          listPage,
          getConversation,
        },
      },
      pipeline: {
        prepare: vi.fn(async (session) => ({
          session,
          markdown: session.conversationId,
          contentSha256: "b".repeat(64),
        })),
      },
      uploader: {
        upload: vi.fn(async () => ({
          status: "uploaded" as const,
          driveFileId: "file",
        })),
      },
    });

    await engine.syncSite("chatgpt");

    expect(listPage).toHaveBeenCalledTimes(2);
    expect(listPage).toHaveBeenNthCalledWith(2, "starred");
    expect(getConversation).toHaveBeenCalledTimes(1);
    expect(getConversation.mock.calls[0]?.[0].conversationId).toBe(
      "new-starred",
    );
    expect(state.sites.chatgpt.watermark).toEqual({
      updatedAt: "2026-07-19T03:00:00.000Z",
      conversationId: "new-starred",
    });
  });

  it("rescans every conversation at the watermark timestamp", async () => {
    let state = createDefaultState("device-test");
    state.sites.grok.enabled = true;
    state.sites.grok.fullBackfillPending = false;
    state.sites.grok.watermark = {
      updatedAt: "2026-07-19T03:00:00.000Z",
      conversationId: "z-existing",
    };
    const store = {
      get: vi.fn(async () => structuredClone(state)),
      update: vi.fn(async (mutate) => {
        state = mutate(structuredClone(state));
        return structuredClone(state);
      }),
    };
    const getConversation = vi.fn(async (item) => ({
      source: "grok-web" as const,
      conversationId: item.conversationId,
      device: "device-test",
      startedAt: item.startedAt,
      updatedAt: item.updatedAt,
      turns: [{ role: "user" as const, text: item.conversationId, media: [] }],
      warnings: [],
    }));
    const engine = new SyncEngine({
      store,
      adapters: {
        grok: {
          source: "grok-web",
          listPage: vi.fn(async () => ({
            items: [
              summary("a-late-arrival", "2026-07-19T03:00:00.000Z"),
              summary("older", "2026-07-19T02:59:59.000Z"),
            ],
          })),
          getConversation,
        },
      },
      pipeline: {
        prepare: vi.fn(async (session) => ({
          session,
          markdown: session.conversationId,
          contentSha256: "c".repeat(64),
        })),
      },
      uploader: {
        upload: vi.fn(async () => ({
          status: "unchanged" as const,
          driveFileId: "existing",
        })),
      },
    });

    await engine.syncSite("grok");

    expect(getConversation).toHaveBeenCalledOnce();
    expect(getConversation.mock.calls[0]?.[0].conversationId).toBe(
      "a-late-arrival",
    );
  });

  it("deduplicates conversations repeated across filter groups", async () => {
    let state = createDefaultState("device-test");
    state.sites.chatgpt.enabled = true;
    const store = {
      get: vi.fn(async () => structuredClone(state)),
      update: vi.fn(async (mutate) => {
        state = mutate(structuredClone(state));
        return structuredClone(state);
      }),
    };
    const duplicate = summary("duplicate", "2026-07-19T03:00:00.000Z");
    const listPage = vi
      .fn()
      .mockResolvedValueOnce({
        items: [duplicate],
        nextCursor: "group-2",
        nextGroupCursor: "group-2",
        globallyOrdered: false,
      })
      .mockResolvedValueOnce({
        items: [duplicate],
        globallyOrdered: false,
      });
    const getConversation = vi.fn(async (item) => ({
      source: "chatgpt-web" as const,
      conversationId: item.conversationId,
      device: "device-test",
      startedAt: item.startedAt,
      updatedAt: item.updatedAt,
      turns: [{ role: "user" as const, text: "duplicate", media: [] }],
      warnings: [],
    }));
    const engine = new SyncEngine({
      store,
      adapters: {
        chatgpt: { source: "chatgpt-web", listPage, getConversation },
      },
      pipeline: {
        prepare: vi.fn(async (session) => ({
          session,
          markdown: "duplicate",
          contentSha256: "d".repeat(64),
        })),
      },
      uploader: {
        upload: vi.fn(async () => ({
          status: "uploaded" as const,
          driveFileId: "file",
        })),
      },
    });

    await engine.syncSite("chatgpt");

    expect(getConversation).toHaveBeenCalledOnce();
  });

  it("never moves an incremental watermark backwards when there is no new item", async () => {
    let state = createDefaultState("device-test");
    state.sites.grok.enabled = true;
    state.sites.grok.fullBackfillPending = false;
    state.sites.grok.watermark = {
      updatedAt: "2026-07-19T03:00:00.000Z",
      conversationId: "current",
    };
    const store = {
      get: vi.fn(async () => structuredClone(state)),
      update: vi.fn(async (mutate) => {
        state = mutate(structuredClone(state));
        return structuredClone(state);
      }),
    };
    const engine = new SyncEngine({
      store,
      adapters: {
        grok: {
          source: "grok-web",
          listPage: vi.fn(async () => ({
            items: [summary("older", "2026-07-19T02:00:00.000Z")],
          })),
          getConversation: vi.fn(),
        },
      },
      pipeline: { prepare: vi.fn() },
      uploader: { upload: vi.fn() },
    });

    await engine.syncSite("grok");

    expect(state.sites.grok.watermark).toEqual({
      updatedAt: "2026-07-19T03:00:00.000Z",
      conversationId: "current",
    });
  });
});
