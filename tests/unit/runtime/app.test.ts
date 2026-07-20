import { afterEach, describe, expect, it, vi } from "vitest";

import { BrainCaptureRuntime } from "../../../src/runtime/app";
import { createDefaultState } from "../../../src/state/store";

function stubStoredState(state: ReturnType<typeof createDefaultState>): void {
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async () => ({ brainCaptureState: state })),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(state, items.brainCaptureState);
        }),
      },
    },
    permissions: {
      contains: vi.fn(async () => true),
      request: vi.fn(async () => true),
      remove: vi.fn(async () => true),
    },
    identity: {
      getAuthToken: vi.fn(),
      removeCachedAuthToken: vi.fn(),
    },
    runtime: { getManifest: vi.fn(() => ({})) },
    action: {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
    },
    scripting: {
      getRegisteredContentScripts: vi.fn(async () => []),
      registerContentScripts: vi.fn(),
      unregisterContentScripts: vi.fn(),
    },
  });
}

describe("BrainCaptureRuntime badge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ignores an error left on a disabled site", async () => {
    const state = createDefaultState("device-test");
    state.status.chatgpt = {
      phase: "error",
      errorCode: "SITE_SCHEMA_CHANGED",
      archived: 0,
      skipped: 0,
    };
    state.sites.grok.enabled = true;
    const setBadgeText = vi.fn(async () => undefined);
    const setBadgeBackgroundColor = vi.fn(async () => undefined);
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async () => ({ brainCaptureState: state })),
          set: vi.fn(async () => undefined),
        },
      },
      permissions: {
        contains: vi.fn(async () => true),
        request: vi.fn(async () => true),
        remove: vi.fn(async () => true),
      },
      identity: {
        getAuthToken: vi.fn(),
        removeCachedAuthToken: vi.fn(),
        clearAllCachedAuthTokens: vi.fn(),
      },
      runtime: { getManifest: vi.fn(() => ({})) },
      action: { setBadgeText, setBadgeBackgroundColor },
      scripting: {
        getRegisteredContentScripts: vi.fn(async () => []),
        registerContentScripts: vi.fn(async () => undefined),
        unregisterContentScripts: vi.fn(async () => undefined),
      },
    });

    await new BrainCaptureRuntime().updateBadge();

    expect(setBadgeText).toHaveBeenCalledWith({ text: "" });
    expect(setBadgeBackgroundColor).toHaveBeenCalledWith({ color: "#146c43" });
  });

  it("recovers statuses left running by an interrupted service worker", async () => {
    const state = createDefaultState("device-test");
    state.sites.claude.enabled = true;
    state.status.claude = {
      phase: "running",
      archived: 16,
      skipped: 2,
      lastRunAt: "2026-07-20T05:40:57.005Z",
    };
    const set = vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(state, items.brainCaptureState);
    });
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async () => ({ brainCaptureState: state })),
          set,
        },
      },
      permissions: {
        contains: vi.fn(async () => true),
        request: vi.fn(async () => true),
        remove: vi.fn(async () => true),
      },
      identity: {
        getAuthToken: vi.fn(),
        removeCachedAuthToken: vi.fn(),
        clearAllCachedAuthTokens: vi.fn(),
      },
      runtime: { getManifest: vi.fn(() => ({})) },
      action: {
        setBadgeText: vi.fn(async () => undefined),
        setBadgeBackgroundColor: vi.fn(async () => undefined),
      },
      scripting: {
        getRegisteredContentScripts: vi.fn(async () => []),
        registerContentScripts: vi.fn(async () => undefined),
        unregisterContentScripts: vi.fn(async () => undefined),
      },
    });

    await new BrainCaptureRuntime().recoverInterruptedSyncs();

    expect(state.status.claude).toEqual({
      phase: "idle",
      errorCode: "SYNC_INTERRUPTED",
      archived: 16,
      skipped: 2,
      lastRunAt: "2026-07-20T05:40:57.005Z",
    });
    expect(set).toHaveBeenCalledOnce();
  });

  it("reconnects after a local disconnect without resetting Chrome OAuth", async () => {
    const state = createDefaultState("device-test");
    state.drive = {
      status: "connected",
      rootFolderId: "root-id",
      connectedAt: "2026-07-20T01:00:00.000Z",
    };
    let oauthAuthorized = true;
    const clearAllCachedAuthTokens = vi.fn(async () => {
      oauthAuthorized = false;
    });
    const getAuthToken = vi.fn(async () => {
      if (!oauthAuthorized) throw new Error("OAuth grant was cleared");
      return { token: "drive-token" };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              files: [
                {
                  id: "root-id",
                  name: "brain-hub",
                  mimeType: "application/vnd.google-apps.folder",
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn(async () => ({ brainCaptureState: state })),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(state, items.brainCaptureState);
          }),
        },
      },
      permissions: {
        contains: vi.fn(async () => true),
        request: vi.fn(async () => true),
        remove: vi.fn(async () => true),
      },
      identity: {
        getAuthToken,
        removeCachedAuthToken: vi.fn(async () => undefined),
        clearAllCachedAuthTokens,
      },
      runtime: {
        getManifest: vi.fn(() => ({
          oauth2: {
            client_id: "real-client.apps.googleusercontent.com",
          },
        })),
      },
      action: {
        setBadgeText: vi.fn(async () => undefined),
        setBadgeBackgroundColor: vi.fn(async () => undefined),
      },
      scripting: {
        getRegisteredContentScripts: vi.fn(async () => []),
        registerContentScripts: vi.fn(async () => undefined),
        unregisterContentScripts: vi.fn(async () => undefined),
      },
    });

    const runtime = new BrainCaptureRuntime();
    await runtime.disconnectDrive();

    await expect(runtime.connectDrive()).resolves.toBe("root-id");
    expect(clearAllCachedAuthTokens).not.toHaveBeenCalled();
    expect(getAuthToken).toHaveBeenCalledWith({ interactive: true });
    expect(state.drive).toMatchObject({
      status: "connected",
      rootFolderId: "root-id",
    });
  });

  it("requests a full backfill when non-personal workspaces are enabled", async () => {
    const state = createDefaultState("device-test");
    state.sites.chatgpt.fullBackfillPending = false;
    state.sites.chatgpt.watermark = {
      updatedAt: "2026-07-20T08:00:00.000Z",
      conversationId: "personal-latest",
    };
    stubStoredState(state);

    await new BrainCaptureRuntime().setSiteOptions("chatgpt", {
      includeNonPersonalWorkspaces: true,
    });

    expect(state.sites.chatgpt.includeNonPersonalWorkspaces).toBe(true);
    expect(state.sites.chatgpt.fullBackfillPending).toBe(true);
    expect(state.sites.chatgpt.watermark).toBeUndefined();
  });

  it("requests a full backfill when the Claude organization changes", async () => {
    const state = createDefaultState("device-test");
    state.sites.claude.organizationId = "org-old";
    state.sites.claude.fullBackfillPending = false;
    state.sites.claude.watermark = {
      updatedAt: "2026-07-20T08:00:00.000Z",
      conversationId: "old-org-latest",
    };
    stubStoredState(state);

    await new BrainCaptureRuntime().setSiteOptions("claude", {
      organizationId: " org-new ",
    });

    expect(state.sites.claude.organizationId).toBe("org-new");
    expect(state.sites.claude.fullBackfillPending).toBe(true);
    expect(state.sites.claude.watermark).toBeUndefined();
  });
});
