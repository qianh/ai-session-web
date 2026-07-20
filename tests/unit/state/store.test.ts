import { describe, expect, it, vi } from "vitest";

import { ChromeStateStore, createDefaultState } from "../../../src/state/store";

describe("ChromeStateStore", () => {
  it("creates privacy-safe defaults and persists control state only", async () => {
    let saved: Record<string, unknown> = {};
    const area = {
      get: vi.fn(async () => saved),
      set: vi.fn(async (value: Record<string, unknown>) => {
        saved = value;
      }),
    };
    const store = new ChromeStateStore(area, () => "device-test");

    expect(await store.get()).toEqual(createDefaultState("device-test"));
    await store.update((state) => ({
      ...state,
      drive: {
        status: "connected",
        rootFolderId: "drive-root",
        connectedAt: "2026-07-19T01:00:00.000Z",
      },
      sites: {
        ...state.sites,
        grok: { ...state.sites.grok, enabled: true },
      },
    }));

    const serialized = JSON.stringify(saved);
    expect(serialized).toContain("drive-root");
    expect(serialized).not.toMatch(
      /turns|messages|mediaUrl|cookie|accessToken|body/u,
    );
  });

  it("preserves a sanitized local Drive diagnostic", async () => {
    let saved: Record<string, unknown> = {};
    const area = {
      get: vi.fn(async () => saved),
      set: vi.fn(async (value: Record<string, unknown>) => {
        saved = value;
      }),
    };
    const store = new ChromeStateStore(area, () => "device-test");

    await store.update((state) => ({
      ...state,
      drive: {
        status: "error",
        errorCode: "DRIVE_NETWORK_FAILED",
        diagnostic: {
          stage: "drive-root",
          name: "TypeError",
          message: "Failed to fetch",
        },
      },
    }));

    await expect(store.get()).resolves.toMatchObject({
      drive: {
        diagnostic: {
          stage: "drive-root",
          name: "TypeError",
          message: "Failed to fetch",
        },
      },
    });
  });
});
