import { describe, expect, it, vi } from "vitest";

import {
  handleHighlightContextMenuClick,
  HIGHLIGHT_CONTEXT_MENU,
  HIGHLIGHT_CONTEXT_MENU_ID,
  installHighlightContextMenu,
} from "../../../src/runtime/highlight-context-menu";

describe("highlight context menu", () => {
  it("defines one selection-only menu for ordinary web pages", () => {
    expect(HIGHLIGHT_CONTEXT_MENU).toEqual({
      id: HIGHLIGHT_CONTEXT_MENU_ID,
      title: "上报 Google Drive",
      contexts: ["selection"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
    });
  });

  it("replaces the fixed menu when the extension is installed or updated", () => {
    const create = vi.fn();
    const remove = vi.fn((_id: string, callback: () => void) => callback());
    const readLastError = vi.fn(() => undefined);

    installHighlightContextMenu({ create, remove }, readLastError);

    expect(remove).toHaveBeenCalledWith(
      HIGHLIGHT_CONTEXT_MENU_ID,
      expect.any(Function),
    );
    expect(readLastError).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(HIGHLIGHT_CONTEXT_MENU);
  });

  it("uploads the selected text inside a keepalive task and notifies success", async () => {
    const uploadHighlight = vi.fn(async () => undefined);
    const runTask = vi.fn(async (task: () => Promise<void>) => task());
    const notify = vi.fn(async () => undefined);

    await expect(
      handleHighlightContextMenuClick(
        {
          menuItemId: HIGHLIGHT_CONTEXT_MENU_ID,
          selectionText: "selected text",
        },
        { uploadHighlight, runTask, notify },
      ),
    ).resolves.toBe(true);

    expect(runTask).toHaveBeenCalledOnce();
    expect(uploadHighlight).toHaveBeenCalledWith("selected text");
    expect(notify).toHaveBeenCalledWith({
      type: "basic",
      iconUrl: "icons/icon-128.png",
      title: "上报成功",
      message: "已上报 Google Drive",
    });
  });

  it("ignores unrelated context menu items", async () => {
    const uploadHighlight = vi.fn(async () => undefined);
    const runTask = vi.fn(async (task: () => Promise<void>) => task());
    const notify = vi.fn(async () => undefined);

    await expect(
      handleHighlightContextMenuClick(
        { menuItemId: "another-menu", selectionText: "selected text" },
        { uploadHighlight, runTask, notify },
      ),
    ).resolves.toBe(false);

    expect(runTask).not.toHaveBeenCalled();
    expect(uploadHighlight).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it.each([
    ["DRIVE_NOT_CONNECTED", "请先打开扩展并连接 Google Drive"],
    ["HIGHLIGHT_EMPTY", "没有可上报的文本"],
    ["HIGHLIGHT_TOO_LARGE", "选中内容超过 512 KiB，请缩小选区后重试"],
    ["UPLOAD_VERIFICATION_FAILED", "Google Drive 写入校验失败，请重试"],
  ])("reports an actionable %s failure", async (code, message) => {
    const uploadHighlight = vi.fn(async () => {
      throw { code };
    });
    const runTask = vi.fn(async (task: () => Promise<void>) => task());
    const notify = vi.fn(async () => undefined);

    await expect(
      handleHighlightContextMenuClick(
        {
          menuItemId: HIGHLIGHT_CONTEXT_MENU_ID,
          selectionText: "selected text",
        },
        { uploadHighlight, runTask, notify },
      ),
    ).resolves.toBe(true);

    expect(notify).toHaveBeenCalledWith({
      type: "basic",
      iconUrl: "icons/icon-128.png",
      title: "上报失败",
      message,
    });
  });

  it.each([
    [{ status: 403 }, "Google Drive 拒绝访问，请重新连接"],
    [{ status: 403, retryable: true }, "Google Drive 请求过多，请稍后重试"],
    [{ status: 429 }, "Google Drive 请求过多，请稍后重试"],
    [new TypeError("network failed"), "无法访问 Google Drive，请检查网络"],
  ])("classifies a Drive failure", async (error, message) => {
    const uploadHighlight = vi.fn(async () => {
      throw error;
    });
    const runTask = vi.fn(async (task: () => Promise<void>) => task());
    const notify = vi.fn(async () => undefined);

    await handleHighlightContextMenuClick(
      {
        menuItemId: HIGHLIGHT_CONTEXT_MENU_ID,
        selectionText: "selected text",
      },
      { uploadHighlight, runTask, notify },
    );

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: "上报失败", message }),
    );
  });
});
