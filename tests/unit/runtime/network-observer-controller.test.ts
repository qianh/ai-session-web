import { describe, expect, it, vi } from "vitest";

import type { StreamTurnCapture } from "../../../src/bridge/stream-capture";
import { NetworkObserverController } from "../../../src/runtime/network-observer-controller";
import { createDefaultState } from "../../../src/state/store";

const capture: StreamTurnCapture = {
  conversationId: "conversation-1",
  userText: "question",
  assistantText: "answer",
  observedAt: "2026-07-20T01:02:03.000Z",
  sourceUrl: "https://grok.com/c/conversation-1",
};

describe("NetworkObserverController", () => {
  it("reconciles only sites that are enabled and still permitted", async () => {
    const state = createDefaultState("device-test");
    state.sites.chatgpt.enabled = true;
    state.sites.grok.enabled = true;
    const reconcile = vi.fn(async () => undefined);
    const controller = new NetworkObserverController({
      store: { get: vi.fn(async () => state) },
      permissions: {
        isGranted: vi.fn(async (site) => site === "grok"),
      },
      registration: {
        setEnabled: vi.fn(async () => undefined),
        reconcile,
      },
      syncSite: vi.fn(async () => undefined),
    });

    await controller.reconcile();

    expect(reconcile).toHaveBeenCalledWith(["grok"]);
  });

  it("delegates explicit site activation and deactivation", async () => {
    const setEnabled = vi.fn(async () => undefined);
    const controller = new NetworkObserverController({
      store: { get: vi.fn(async () => createDefaultState("device-test")) },
      permissions: { isGranted: vi.fn(async () => true) },
      registration: {
        setEnabled,
        reconcile: vi.fn(async () => undefined),
      },
      syncSite: vi.fn(async () => undefined),
    });

    await controller.setEnabled("claude", true);
    await controller.setEnabled("claude", false);

    expect(setEnabled).toHaveBeenNthCalledWith(1, "claude", true);
    expect(setEnabled).toHaveBeenNthCalledWith(2, "claude", false);
  });

  it("ignores disabled sites and coalesces enabled-site completion signals", async () => {
    const state = createDefaultState("device-test");
    state.sites.grok.enabled = true;
    let release: (() => void) | undefined;
    const syncSite = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const controller = new NetworkObserverController({
      store: { get: vi.fn(async () => state) },
      permissions: { isGranted: vi.fn(async () => true) },
      registration: {
        setEnabled: vi.fn(async () => undefined),
        reconcile: vi.fn(async () => undefined),
      },
      syncSite,
    });

    await expect(controller.handleCompletion("chatgpt")).resolves.toBe(false);
    const first = controller.handleCompletion("grok");
    const second = controller.handleCompletion("grok");
    await vi.waitFor(() => expect(syncSite).toHaveBeenCalledOnce());
    release?.();

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(syncSite).toHaveBeenCalledWith("grok");
  });

  it("archives the captured turn only when the main sync fails", async () => {
    const state = createDefaultState("device-test");
    state.sites.grok.enabled = true;
    const mainError = new Error("schema changed");
    const archiveFallback = vi.fn(async () => undefined);
    const controller = new NetworkObserverController({
      store: { get: vi.fn(async () => state) },
      permissions: { isGranted: vi.fn(async () => true) },
      registration: {
        setEnabled: vi.fn(async () => undefined),
        reconcile: vi.fn(async () => undefined),
      },
      syncSite: vi.fn(async () => {
        throw mainError;
      }),
      archiveFallback,
    });

    await expect(controller.handleCompletion("grok", capture)).rejects.toBe(
      mainError,
    );
    expect(archiveFallback).toHaveBeenCalledWith("grok", capture);
  });

  it("does not archive the captured turn after a successful main sync", async () => {
    const state = createDefaultState("device-test");
    state.sites.grok.enabled = true;
    const archiveFallback = vi.fn(async () => undefined);
    const controller = new NetworkObserverController({
      store: { get: vi.fn(async () => state) },
      permissions: { isGranted: vi.fn(async () => true) },
      registration: {
        setEnabled: vi.fn(async () => undefined),
        reconcile: vi.fn(async () => undefined),
      },
      syncSite: vi.fn(async () => undefined),
      archiveFallback,
    });

    await expect(controller.handleCompletion("grok", capture)).resolves.toBe(
      true,
    );
    expect(archiveFallback).not.toHaveBeenCalled();
  });

  it("preserves the main sync error when fallback upload also fails", async () => {
    const state = createDefaultState("device-test");
    state.sites.grok.enabled = true;
    const mainError = new Error("schema changed");
    const controller = new NetworkObserverController({
      store: { get: vi.fn(async () => state) },
      permissions: { isGranted: vi.fn(async () => true) },
      registration: {
        setEnabled: vi.fn(async () => undefined),
        reconcile: vi.fn(async () => undefined),
      },
      syncSite: vi.fn(async () => {
        throw mainError;
      }),
      archiveFallback: vi.fn(async () => {
        throw new Error("fallback failed");
      }),
    });

    await expect(controller.handleCompletion("grok", capture)).rejects.toBe(
      mainError,
    );
  });
});
