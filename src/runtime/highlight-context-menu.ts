export const HIGHLIGHT_CONTEXT_MENU_ID = "upload-highlight-to-google-drive";
export const HIGHLIGHT_CONTEXT_MENU = {
  id: HIGHLIGHT_CONTEXT_MENU_ID,
  title: "上报 Google Drive",
  contexts: ["selection"],
  documentUrlPatterns: ["http://*/*", "https://*/*"],
} as const;

interface ContextMenuInstallApi {
  create(properties: typeof HIGHLIGHT_CONTEXT_MENU): unknown;
  remove(menuItemId: string, callback: () => void): void;
}

export function installHighlightContextMenu(
  api: ContextMenuInstallApi,
  readLastError: () => unknown,
): void {
  api.remove(HIGHLIGHT_CONTEXT_MENU_ID, () => {
    readLastError();
    api.create(HIGHLIGHT_CONTEXT_MENU);
  });
}

export interface HighlightNotification {
  type: "basic";
  iconUrl: string;
  title: string;
  message: string;
}

interface HighlightMenuClick {
  menuItemId: string | number;
  selectionText?: string;
}

export interface HighlightContextMenuOptions {
  uploadHighlight(selectionText: string): Promise<void>;
  runTask(task: () => Promise<void>): Promise<void>;
  notify(notification: HighlightNotification): Promise<unknown>;
}

const FAILURE_MESSAGES: Record<string, string> = {
  DRIVE_NOT_CONNECTED: "请先打开扩展并连接 Google Drive",
  HIGHLIGHT_EMPTY: "没有可上报的文本",
  HIGHLIGHT_TOO_LARGE: "选中内容超过 512 KiB，请缩小选区后重试",
  UPLOAD_VERIFICATION_FAILED: "Google Drive 写入校验失败，请重试",
};

function errorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "HIGHLIGHT_UPLOAD_FAILED";
}

function failureMessage(error: unknown): string {
  if (error instanceof TypeError) {
    return "无法访问 Google Drive，请检查网络";
  }
  if (typeof error === "object" && error !== null && "status" in error) {
    const retryable = "retryable" in error && error.retryable === true;
    if (error.status === 429 || (error.status === 403 && retryable)) {
      return "Google Drive 请求过多，请稍后重试";
    }
    if (error.status === 403) return "Google Drive 拒绝访问，请重新连接";
  }
  return FAILURE_MESSAGES[errorCode(error)] ?? "上报失败，请稍后重试";
}

export async function handleHighlightContextMenuClick(
  info: HighlightMenuClick,
  options: HighlightContextMenuOptions,
): Promise<boolean> {
  if (info.menuItemId !== HIGHLIGHT_CONTEXT_MENU_ID) return false;
  try {
    await options.runTask(() =>
      options.uploadHighlight(info.selectionText ?? ""),
    );
  } catch (error) {
    await options.notify({
      type: "basic",
      iconUrl: "icons/icon-128.png",
      title: "上报失败",
      message: failureMessage(error),
    });
    return true;
  }
  await options.notify({
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title: "上报成功",
    message: "已上报 Google Drive",
  });
  return true;
}
