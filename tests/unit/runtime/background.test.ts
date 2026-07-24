import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  RuntimeRequest,
  RuntimeResponse,
} from "../../../src/runtime/messages";
import { HIGHLIGHT_CONTEXT_MENU_ID } from "../../../src/runtime/highlight-context-menu";

describe("background runtime messages", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it.each([
    { type: "SYNC_SITE", site: "chatgpt" } as const,
    { type: "SYNC_ALL" } as const,
  ])(
    "reports a $type failure only after the sync task finishes",
    async (request) => {
      vi.stubGlobal("defineBackground", (setup: () => void) => setup);
      const background = (await import("../../../entrypoints/background")) as {
        createBackgroundMessageListener?: (options: {
          handle(request: RuntimeRequest): Promise<unknown>;
          runTask(task: () => Promise<unknown>): Promise<unknown>;
        }) => (
          message: unknown,
          sender: { tab?: { url?: string } },
          sendResponse: (response: RuntimeResponse) => void,
        ) => boolean | undefined;
      };
      const sync = deferred<void>();
      const handle = vi.fn(() => sync.promise);
      const runTask = vi.fn((task: () => Promise<unknown>) => {
        const result = task();
        void result.catch(() => undefined);
        return result;
      });
      const sendResponse = vi.fn<(response: RuntimeResponse) => void>();
      const listener = background.createBackgroundMessageListener?.({
        handle,
        runTask,
      });

      expect(listener).toBeTypeOf("function");
      expect(listener?.(request, {}, sendResponse)).toBe(true);
      expect(sendResponse).not.toHaveBeenCalled();
      expect(handle).toHaveBeenCalledWith(request);
      expect(runTask).toHaveBeenCalledOnce();

      sync.reject({ code: "SITE_HTTP_429" });
      await expect(sync.promise).rejects.toEqual({ code: "SITE_HTTP_429" });
      await vi.waitFor(() =>
        expect(sendResponse).toHaveBeenCalledWith({
          ok: false,
          errorCode: "SITE_HTTP_429",
        }),
      );
    },
  );

  it("detaches a trusted observed-conversation sync from its message channel", async () => {
    vi.stubGlobal("defineBackground", (setup: () => void) => setup);
    const background = (await import("../../../entrypoints/background")) as {
      createBackgroundMessageListener?: (options: {
        handle(request: RuntimeRequest): Promise<unknown>;
        runTask(task: () => Promise<unknown>): Promise<unknown>;
      }) => (
        message: unknown,
        sender: { tab?: { url?: string } },
        sendResponse: (response: RuntimeResponse) => void,
      ) => boolean | undefined;
    };
    const sync = deferred<void>();
    const handle = vi.fn(() => sync.promise);
    const runTask = vi.fn((task: () => Promise<unknown>) => {
      const result = task();
      void result.catch(() => undefined);
      return result;
    });
    const sendResponse = vi.fn<(response: RuntimeResponse) => void>();
    const listener = background.createBackgroundMessageListener!({
      handle,
      runTask,
    });

    expect(
      listener(
        { type: "OBSERVED_CONVERSATION_COMPLETE", site: "chatgpt" },
        { tab: { url: "https://chatgpt.com/c/conversation" } },
        sendResponse,
      ),
    ).toBeUndefined();
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
    expect(runTask).toHaveBeenCalledOnce();

    sync.resolve();
    await sync.promise;
  });

  it("keeps the service worker active only while a sync task is running", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("defineBackground", (setup: () => void) => setup);
    const background = (await import("../../../entrypoints/background")) as {
      ServiceWorkerKeepalive?: new (api: {
        getPlatformInfo(): Promise<unknown>;
      }) => {
        run<T>(task: () => Promise<T>): Promise<T>;
      };
    };
    const getPlatformInfo = vi.fn(async () => ({}));
    const task = deferred<string>();

    expect(background.ServiceWorkerKeepalive).toBeTypeOf("function");
    const keepalive = new background.ServiceWorkerKeepalive!({
      getPlatformInfo,
    });
    const result = keepalive.run(() => task.promise);

    expect(getPlatformInfo).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(getPlatformInfo).toHaveBeenCalledTimes(2);

    task.resolve("done");
    await expect(result).resolves.toBe("done");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(getPlatformInfo).toHaveBeenCalledTimes(2);
  });

  it("shares one keepalive until all overlapping sync tasks finish", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("defineBackground", (setup: () => void) => setup);
    const background = (await import("../../../entrypoints/background")) as {
      ServiceWorkerKeepalive?: new (api: {
        getPlatformInfo(): Promise<unknown>;
      }) => {
        run<T>(task: () => Promise<T>): Promise<T>;
      };
    };
    const getPlatformInfo = vi.fn(async () => ({}));
    const first = deferred<void>();
    const second = deferred<void>();

    const keepalive = new background.ServiceWorkerKeepalive!({
      getPlatformInfo,
    });
    const firstRun = keepalive.run(() => first.promise);
    const secondRun = keepalive.run(() => second.promise);

    expect(getPlatformInfo).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(getPlatformInfo).toHaveBeenCalledTimes(2);

    first.resolve();
    await firstRun;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(getPlatformInfo).toHaveBeenCalledTimes(3);

    second.resolve();
    await secondRun;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(getPlatformInfo).toHaveBeenCalledTimes(3);
  });

  it("detaches a highlight upload from the context-menu event", async () => {
    vi.stubGlobal("defineBackground", (setup: () => void) => setup);
    const background = (await import("../../../entrypoints/background")) as {
      createHighlightContextMenuListener?: (options: {
        uploadHighlight(selectionText: string): Promise<void>;
        runTask(task: () => Promise<void>): Promise<void>;
        notify(notification: {
          type: "basic";
          iconUrl: string;
          title: string;
          message: string;
        }): Promise<unknown>;
      }) => (info: {
        menuItemId: string | number;
        selectionText?: string;
      }) => void;
    };
    const uploadHighlight = vi.fn(async () => undefined);
    const runTask = vi.fn(async (task: () => Promise<void>) => task());
    const notify = vi.fn(async () => undefined);
    const listener = background.createHighlightContextMenuListener?.({
      uploadHighlight,
      runTask,
      notify,
    });

    expect(listener).toBeTypeOf("function");
    expect(
      listener?.({
        menuItemId: HIGHLIGHT_CONTEXT_MENU_ID,
        selectionText: "selected text",
      }),
    ).toBeUndefined();
    await vi.waitFor(() =>
      expect(uploadHighlight).toHaveBeenCalledWith("selected text"),
    );
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ title: "上报成功" }),
      ),
    );
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}
