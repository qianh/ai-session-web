import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PopupApp, type PopupClient } from "../../../entrypoints/popup/App";
import { createDefaultState } from "../../../src/state/store";

function dashboard(grokEnabled = false) {
  const state = createDefaultState("device-test");
  state.drive = {
    status: "connected",
    rootFolderId: "drive-root",
    connectedAt: "2026-07-19T01:00:00.000Z",
  };
  state.sites.grok.enabled = grokEnabled;
  return {
    state,
    permissions: { chatgpt: false, claude: false, gemini: false, grok: false },
    oauthConfigured: true,
  };
}

describe("PopupApp", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders Drive and all four site controls", async () => {
    const client: PopupClient = {
      request: vi.fn(async () => dashboard(true)),
      requestSitePermission: vi.fn(),
      removeSitePermission: vi.fn(),
    };
    render(<PopupApp client={client} />);

    expect(await screen.findByText("Brain Capture")).toBeInTheDocument();
    expect(screen.getByText("Google Drive 已连接")).toBeInTheDocument();
    for (const site of ["ChatGPT", "Claude", "Gemini", "Grok"]) {
      expect(screen.getByText(site)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "同步全部" })).toBeEnabled();
  });

  it("shows persisted progress while a site is syncing", async () => {
    const data = dashboard(true);
    data.state.status.grok = {
      phase: "running",
      archived: 16,
      skipped: 2,
      lastRunAt: "2026-07-20T05:40:57.005Z",
    };
    const client: PopupClient = {
      request: vi.fn(async () => data),
      requestSitePermission: vi.fn(),
      removeSitePermission: vi.fn(),
    };

    render(<PopupApp client={client} />);

    expect(
      await screen.findByText("正在同步 · 16 已归档 · 2 已跳过"),
    ).toBeInTheDocument();
  });

  it.each([
    ["SITE_HTTP_429", "站点限流，稍后自动重试"],
    ["BRIDGE_REQUEST_FAILED", "网络波动，稍后自动重试"],
    ["SITE_SCHEMA_CHANGED", "会话解析失败"],
    ["SITE_LIST_FAILED", "会话列表读取失败，请重试"],
    ["SITE_DETAIL_FAILED", "个别会话读取失败，请重试"],
    ["DRIVE_RATE_LIMITED", "Google Drive 限流，稍后自动重试"],
    ["DRIVE_AUTH_REQUIRED", "Google Drive 授权已失效，请重新连接"],
    ["DRIVE_PERMISSION_DENIED", "Google Drive 拒绝访问，请重新授权 Drive 权限"],
    ["UPLOAD_VERIFICATION_FAILED", "Drive 写入提交失败，请重试"],
    ["SYNC_FAILED", "同步内部错误，请重新加载扩展后重试"],
  ])("shows the actionable %s site status", async (errorCode, message) => {
    const data = dashboard(true);
    data.state.status.grok = {
      phase: "error",
      errorCode,
      archived: 0,
      skipped: 0,
    };
    const client: PopupClient = {
      request: vi.fn(async () => data),
      requestSitePermission: vi.fn(),
      removeSitePermission: vi.fn(),
    };

    render(<PopupApp client={client} />);

    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it("shows when a previous sync was interrupted", async () => {
    const data = dashboard(true);
    data.state.status.grok = {
      phase: "idle",
      errorCode: "SYNC_INTERRUPTED",
      archived: 16,
      skipped: 2,
    };
    const client: PopupClient = {
      request: vi.fn(async () => data),
      requestSitePermission: vi.fn(),
      removeSitePermission: vi.fn(),
    };

    render(<PopupApp client={client} />);

    expect(
      await screen.findByText("上次同步中断，点击重试"),
    ).toBeInTheDocument();
  });

  it("offers reconnection when the stored Drive authorization has expired", async () => {
    const data = dashboard(true);
    data.state.drive = {
      status: "error",
      rootFolderId: "drive-root",
      connectedAt: "2026-07-19T01:00:00.000Z",
      errorCode: "DRIVE_AUTH_REQUIRED",
    };
    const client: PopupClient = {
      request: vi.fn(async () => data),
      requestSitePermission: vi.fn(),
      removeSitePermission: vi.fn(),
    };

    render(<PopupApp client={client} />);

    expect(
      await screen.findByText("Google Drive 需重新授权"),
    ).toBeInTheDocument();
    expect(screen.getByText("授权已失效")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "连接" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "同步全部" })).toBeDisabled();
  });

  it("keeps successful progress visible when a site ends with an error", async () => {
    const data = dashboard(true);
    data.state.status.grok = {
      phase: "error",
      errorCode: "SITE_DETAIL_FAILED",
      archived: 140,
      skipped: 1,
    };
    const client: PopupClient = {
      request: vi.fn(async () => data),
      requestSitePermission: vi.fn(),
      removeSitePermission: vi.fn(),
    };

    render(<PopupApp client={client} />);

    expect(
      await screen.findByText(
        "个别会话读取失败，请重试 · 140 已归档 · 1 已跳过",
      ),
    ).toBeInTheDocument();
  });

  it("refreshes the site status after a manual sync fails", async () => {
    const data = dashboard(true);
    const request = vi.fn(async (message) => {
      if (message.type === "SYNC_SITE") {
        data.state.status.grok = {
          phase: "error",
          errorCode: "SITE_HTTP_429",
          archived: 0,
          skipped: 4,
        };
        throw new Error("sync failed");
      }
      return data;
    });
    const client: PopupClient = {
      request,
      requestSitePermission: vi.fn(),
      removeSitePermission: vi.fn(),
    };

    render(<PopupApp client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "同步 Grok" }));

    expect(
      await screen.findByText("站点限流，稍后自动重试 · 0 已归档 · 4 已跳过"),
    ).toBeInTheDocument();
    expect(
      request.mock.calls.filter(
        ([message]) => message.type === "GET_DASHBOARD",
      ),
    ).toHaveLength(2);
  });

  it.each([
    ["SITE_HTTP_429", "站点限流，稍后自动重试"],
    ["BRIDGE_REQUEST_FAILED", "网络波动，稍后自动重试"],
    ["DRIVE_RATE_LIMITED", "Google Drive 限流，稍后自动重试"],
    ["DRIVE_AUTH_REQUIRED", "Google Drive 授权已失效，请重新连接"],
    ["UPLOAD_VERIFICATION_FAILED", "Drive 写入提交失败，请重试"],
  ])(
    "translates %s in both the notice and site row",
    async (errorCode, message) => {
      const data = dashboard(true);
      const sendMessage = vi.fn(async (request: { type: string }) => {
        if (request.type === "SYNC_SITE") {
          data.state.status.grok = {
            phase: "error",
            errorCode,
            archived: 0,
            skipped: 4,
          };
          return { ok: false, errorCode };
        }
        return { ok: true, data };
      });
      vi.stubGlobal("chrome", { runtime: { sendMessage } });

      render(<PopupApp />);
      fireEvent.click(await screen.findByRole("button", { name: "同步 Grok" }));

      await waitFor(() => {
        expect(screen.getByText(message)).toBeInTheDocument();
        expect(
          screen.getByText(`${message} · 0 已归档 · 4 已跳过`),
        ).toBeInTheDocument();
      });
    },
  );

  it("requests only the selected site permission before enabling it", async () => {
    const request = vi.fn(async (message) =>
      message.type === "GET_DASHBOARD" ? dashboard() : undefined,
    );
    const requestSitePermission = vi.fn(async () => true);
    const client: PopupClient = {
      request,
      requestSitePermission,
      removeSitePermission: vi.fn(),
    };
    render(<PopupApp client={client} />);
    const toggle = await screen.findByRole("switch", { name: "启用 Grok" });

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(requestSitePermission).toHaveBeenCalledWith("grok"),
    );
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith({
        type: "SET_SITE_ENABLED",
        site: "grok",
        enabled: true,
      }),
    );
  });

  it("explains when Google authorization did not complete", async () => {
    const disconnected = dashboard();
    disconnected.state.drive = { status: "disconnected" };
    const sendMessage = vi.fn(async (message: { type: string }) =>
      message.type === "GET_DASHBOARD"
        ? { ok: true, data: disconnected }
        : { ok: false, errorCode: "GOOGLE_AUTH_FAILED" },
    );
    vi.stubGlobal("chrome", { runtime: { sendMessage } });

    render(<PopupApp />);
    fireEvent.click(await screen.findByRole("button", { name: "连接" }));

    expect(
      await screen.findByText("Google 授权未完成，请重新连接并完成最后一步"),
    ).toBeInTheDocument();
  });

  it.each([
    ["DRIVE_PERMISSION_DENIED", "Google Drive 拒绝访问，请重新授权 Drive 权限"],
    ["DRIVE_NETWORK_FAILED", "无法访问 Google Drive，请检查网络后重试"],
    ["DRIVE_CONNECT_FAILED", "Google Drive 连接失败，请重新授权后重试"],
  ])("explains the %s connection failure", async (errorCode, message) => {
    const disconnected = dashboard();
    disconnected.state.drive = { status: "disconnected" };
    const sendMessage = vi.fn(async (request: { type: string }) =>
      request.type === "GET_DASHBOARD"
        ? { ok: true, data: disconnected }
        : { ok: false, errorCode },
    );
    vi.stubGlobal("chrome", { runtime: { sendMessage } });

    render(<PopupApp />);
    fireEvent.click(await screen.findByRole("button", { name: "连接" }));

    expect(await screen.findByText(message)).toBeInTheDocument();
  });
});
