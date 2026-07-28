import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleDriveGateway } from "../../../src/drive/google-drive";
import type {
  DriveEntry,
  DriveObject,
  DrivePort,
  DrivePutInput,
} from "../../../src/drive/types";
import { BrainCaptureRuntime } from "../../../src/runtime/app";
import { createDefaultState } from "../../../src/state/store";

function stubStoredState(state: ReturnType<typeof createDefaultState>) {
  const getAuthToken = vi.fn(async (): Promise<{ token?: string }> => ({}));
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
  return { getAuthToken };
}

describe("BrainCaptureRuntime badge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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

  it("revokes Chrome OAuth and clears local state on disconnect", async () => {
    const state = createDefaultState("device-test");
    state.drive = {
      status: "connected",
      rootFolderId: "root-id",
      accountEmail: "person@example.com",
      accountDisplayName: "Person",
      accountPermissionId: "permission-1",
      connectedAt: "2026-07-20T01:00:00.000Z",
    };
    state.sites.chatgpt.enabled = true;
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

    expect(clearAllCachedAuthTokens).toHaveBeenCalledOnce();
    expect(getAuthToken).toHaveBeenCalledWith({ interactive: false });
    expect(state.drive).toEqual({ status: "disconnected" });
    expect(state.sites.chatgpt).toMatchObject({
      enabled: false,
      fullBackfillPending: true,
    });
    expect(JSON.stringify(state)).not.toContain("person@example.com");
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

  it("rejects a highlight when Drive is not connected", async () => {
    const state = createDefaultState("device-test");
    stubStoredState(state);

    await expect(
      new BrainCaptureRuntime().uploadHighlight("selected text"),
    ).rejects.toMatchObject({ code: "DRIVE_NOT_CONNECTED" });
  });

  it("sends a connected highlight through the Drive gateway", async () => {
    const state = createDefaultState("device-test");
    state.drive = {
      status: "connected",
      rootFolderId: "root-id",
      connectedAt: "2026-07-23T07:00:00.000Z",
    };
    const { getAuthToken } = stubStoredState(state);
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "denied" }), { status: 403 }),
    );
    vi.stubGlobal("fetch", fetch);
    getAuthToken.mockResolvedValue({ token: "drive-token" });

    await expect(
      new BrainCaptureRuntime().uploadHighlight("selected text"),
    ).rejects.toMatchObject({ status: 403 });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("serializes concurrent highlight uploads before resolving Drive paths", async () => {
    const state = createDefaultState("device-test");
    state.drive = {
      status: "connected",
      rootFolderId: "root-id",
      connectedAt: "2026-07-23T07:00:00.000Z",
    };
    stubStoredState(state);

    let releaseFirstPut: (() => void) | undefined;
    const firstPutBlocked = new Promise<void>((resolve) => {
      releaseFirstPut = resolve;
    });
    const objects = new Map<string, DriveObject>();
    let activePuts = 0;
    let maxActivePuts = 0;
    let putCount = 0;
    const put = vi.fn(async (input: DrivePutInput): Promise<DriveEntry> => {
      activePuts += 1;
      maxActivePuts = Math.max(maxActivePuts, activePuts);
      const id = `file-${++putCount}`;
      const object: DriveObject = {
        id,
        path: input.path,
        mimeType: input.mimeType,
        modifiedTime: "2026-07-23T07:30:12.000Z",
        appProperties: input.appProperties ?? {},
        bytes: Uint8Array.from(input.bytes),
      };
      objects.set(id, object);
      if (putCount === 1) await firstPutBlocked;
      activePuts -= 1;
      return object;
    });
    const drive: DrivePort = {
      listByAppProperty: vi.fn(async () => []),
      put,
      read: vi.fn(async (id) => {
        const object = objects.get(id);
        if (!object) throw new Error("missing object");
        return object;
      }),
      move: vi.fn(async (id, path) => {
        const object = objects.get(id);
        if (!object) throw new Error("missing object");
        object.path = path;
        return object;
      }),
      trash: vi.fn(async () => undefined),
    };
    vi.spyOn(GoogleDriveGateway.prototype, "forRoot").mockReturnValue(drive);

    const runtime = new BrainCaptureRuntime();
    const first = runtime.uploadHighlight("first selection");
    await vi.waitFor(() => expect(put).toHaveBeenCalledOnce());
    const second = runtime.uploadHighlight("second selection");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const callsBeforeRelease = put.mock.calls.length;
    releaseFirstPut?.();
    await Promise.all([first, second]);

    expect(callsBeforeRelease).toBe(1);
    expect(maxActivePuts).toBe(1);
    expect(put).toHaveBeenCalledTimes(2);
  });
});
