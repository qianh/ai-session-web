import {
  AlertCircle,
  Check,
  ChevronDown,
  Cloud,
  Copy,
  Database,
  Link2,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Settings2,
  Unplug,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  DashboardData,
  RuntimeRequest,
  RuntimeResponse,
} from "../../src/runtime/messages";
import { SitePermissionService } from "../../src/platform/site-permissions";
import { SITE_IDS, type AppState, type SiteId } from "../../src/state/store";

export interface PopupClient {
  request(message: RuntimeRequest): Promise<unknown>;
  requestSitePermission(site: SiteId): Promise<boolean>;
  removeSitePermission(site: SiteId): Promise<boolean>;
}

const SITE_META: Record<SiteId, { name: string; domain: string }> = {
  chatgpt: { name: "ChatGPT", domain: "chatgpt.com" },
  claude: { name: "Claude", domain: "claude.ai" },
  gemini: { name: "Gemini", domain: "gemini.google.com" },
  grok: { name: "Grok", domain: "grok.com" },
};

const EXTENSION_ID = "gljnhnhnkdjofigpbfdhiacbelljijmn";
const MB = 1024 * 1024;

export function PopupApp({ client }: { client?: PopupClient }) {
  const activeClient = useMemo(() => client ?? createDefaultClient(), [client]);
  const [dashboard, setDashboard] = useState<DashboardData>();
  const [busy, setBusy] = useState<string>();
  const [expanded, setExpanded] = useState<SiteId>();
  const [errorCode, setErrorCode] = useState<string>();

  const load = useCallback(async () => {
    const result = await activeClient.request({ type: "GET_DASHBOARD" });
    setDashboard(result as DashboardData);
  }, [activeClient]);

  useEffect(() => {
    void load().catch(() => setErrorCode("RUNTIME_FAILED"));
  }, [load]);

  const run = useCallback(
    async (key: string, request: RuntimeRequest) => {
      setBusy(key);
      setErrorCode(undefined);
      try {
        await activeClient.request(request);
        await load();
      } catch (error) {
        setErrorCode(readErrorCode(error));
        await load().catch(() => undefined);
      } finally {
        setBusy(undefined);
      }
    },
    [activeClient, load],
  );

  const toggleSite = useCallback(
    async (site: SiteId, enabled: boolean) => {
      setBusy(`site-${site}`);
      setErrorCode(undefined);
      try {
        if (enabled && !(await activeClient.requestSitePermission(site))) {
          throw new PopupError("SITE_PERMISSION_DENIED");
        }
        await activeClient.request({ type: "SET_SITE_ENABLED", site, enabled });
        if (!enabled) await activeClient.removeSitePermission(site);
        await load();
      } catch (error) {
        setErrorCode(readErrorCode(error));
      } finally {
        setBusy(undefined);
      }
    },
    [activeClient, load],
  );

  if (!dashboard) {
    return (
      <main
        className="popup-shell loading-state"
        aria-label="Brain Capture 加载中"
      >
        <LoaderCircle className="spin" size={22} aria-hidden="true" />
      </main>
    );
  }

  const { state } = dashboard;
  const driveConnected = state.drive.status === "connected";
  const driveAuthRequired =
    state.drive.status === "error" &&
    state.drive.errorCode === "DRIVE_AUTH_REQUIRED";
  const enabledCount = SITE_IDS.filter(
    (site) => state.sites[site].enabled,
  ).length;

  return (
    <main className="popup-shell">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">
          <Database size={18} />
        </div>
        <div className="brand-copy">
          <h1>Brain Capture</h1>
          <p>{enabledCount} 个站点已启用</p>
        </div>
        <button
          className="icon-button header-sync"
          type="button"
          title="同步全部"
          aria-label="同步全部"
          disabled={!driveConnected || enabledCount === 0 || Boolean(busy)}
          onClick={() => void run("sync-all", { type: "SYNC_ALL" })}
        >
          <RefreshCw
            size={17}
            className={busy === "sync-all" ? "spin" : undefined}
          />
        </button>
      </header>

      {!dashboard.oauthConfigured && (
        <section className="notice warning-notice" aria-label="OAuth 配置状态">
          <AlertCircle size={17} aria-hidden="true" />
          <div>
            <strong>OAuth Client ID 未配置</strong>
            <code>{EXTENSION_ID}</code>
          </div>
          <button
            className="icon-button"
            type="button"
            title="复制扩展 ID"
            aria-label="复制扩展 ID"
            onClick={() => void navigator.clipboard.writeText(EXTENSION_ID)}
          >
            <Copy size={16} />
          </button>
        </section>
      )}

      {errorCode && (
        <section className="notice error-notice" role="alert">
          <AlertCircle size={17} aria-hidden="true" />
          <span>{errorLabel(errorCode)}</span>
        </section>
      )}

      <section className="drive-band" aria-label="Google Drive">
        <div className={`service-icon ${driveConnected ? "connected" : ""}`}>
          <Cloud size={19} aria-hidden="true" />
        </div>
        <div className="service-copy">
          <strong>
            {driveConnected
              ? "Google Drive 已连接"
              : driveAuthRequired
                ? "Google Drive 需重新授权"
                : "Google Drive 未连接"}
          </strong>
          <span>
            {driveConnected
              ? "brain-hub"
              : driveAuthRequired
                ? "授权已失效"
                : "等待授权"}
          </span>
        </div>
        {driveConnected ? (
          <button
            className="icon-button"
            type="button"
            title="断开 Google Drive"
            aria-label="断开 Google Drive"
            disabled={Boolean(busy)}
            onClick={() => void run("drive", { type: "DISCONNECT_DRIVE" })}
          >
            <Unplug size={16} />
          </button>
        ) : (
          <button
            className="command-button"
            type="button"
            disabled={!dashboard.oauthConfigured || Boolean(busy)}
            onClick={() => void run("drive", { type: "CONNECT_DRIVE" })}
          >
            {busy === "drive" ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Link2 size={15} />
            )}
            连接
          </button>
        )}
      </section>

      <section className="sites-section" aria-labelledby="sites-title">
        <div className="section-heading">
          <h2 id="sites-title">归档站点</h2>
          <span>30 分钟增量</span>
        </div>
        <div className="site-list">
          {SITE_IDS.map((site) => {
            const meta = SITE_META[site];
            const settings = state.sites[site];
            const status = state.status[site];
            const isBusy = busy === `site-${site}` || busy === `sync-${site}`;
            const isExpanded = expanded === site;
            return (
              <article className="site-row" key={site}>
                <div className="site-main-row">
                  <span
                    className={`status-dot phase-${status.phase}`}
                    aria-hidden="true"
                  />
                  <div className="site-copy">
                    <strong>{meta.name}</strong>
                    <span>
                      {siteSubtitle(
                        settings.fullBackfillPending,
                        status,
                        meta.domain,
                      )}
                    </span>
                  </div>
                  <button
                    className="icon-button compact"
                    type="button"
                    title={`${meta.name} 设置`}
                    aria-label={`${meta.name} 设置`}
                    aria-expanded={isExpanded}
                    onClick={() => setExpanded(isExpanded ? undefined : site)}
                  >
                    {isExpanded ? (
                      <ChevronDown size={16} />
                    ) : (
                      <Settings2 size={16} />
                    )}
                  </button>
                  <button
                    className="icon-button compact"
                    type="button"
                    title={`同步 ${meta.name}`}
                    aria-label={`同步 ${meta.name}`}
                    disabled={
                      !driveConnected || !settings.enabled || Boolean(busy)
                    }
                    onClick={() =>
                      void run(`sync-${site}`, { type: "SYNC_SITE", site })
                    }
                  >
                    <RefreshCw
                      size={15}
                      className={busy === `sync-${site}` ? "spin" : undefined}
                    />
                  </button>
                  <button
                    className={`switch ${settings.enabled ? "on" : ""}`}
                    type="button"
                    role="switch"
                    aria-checked={settings.enabled}
                    aria-label={`启用 ${meta.name}`}
                    disabled={isBusy}
                    onClick={() => void toggleSite(site, !settings.enabled)}
                  >
                    <span>{settings.enabled && <Check size={11} />}</span>
                  </button>
                </div>
                {isExpanded && (
                  <div className="site-options">
                    <label className="check-option">
                      <input
                        type="checkbox"
                        checked={settings.includeNonPersonalWorkspaces}
                        onChange={(event) =>
                          void run(`options-${site}`, {
                            type: "SET_SITE_OPTIONS",
                            site,
                            includeNonPersonalWorkspaces: event.target.checked,
                          })
                        }
                      />
                      <span>包括团队/组织空间</span>
                    </label>
                    {site === "claude" && (
                      <label className="field-option">
                        <span>Organization ID</span>
                        <input
                          type="text"
                          defaultValue={settings.organizationId ?? ""}
                          placeholder="自动识别"
                          onBlur={(event) => {
                            if (event.target.value.trim()) {
                              void run("options-claude", {
                                type: "SET_SITE_OPTIONS",
                                site: "claude",
                                organizationId: event.target.value.trim(),
                              });
                            }
                          }}
                        />
                      </label>
                    )}
                    <button
                      className="text-action"
                      type="button"
                      onClick={() =>
                        void run(`reset-${site}`, {
                          type: "RESET_BACKFILL",
                          site,
                        })
                      }
                    >
                      <RotateCcw size={14} />
                      下次全量补拉
                    </button>
                    {status.errorCode && (
                      <code className="error-code">{status.errorCode}</code>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <footer className="settings-band">
        <label htmlFor="media-limit">单个附件上限</label>
        <div className="select-wrap">
          <select
            id="media-limit"
            value={String(state.media.maxBytes / MB)}
            disabled={Boolean(busy)}
            onChange={(event) =>
              void run("media-limit", {
                type: "SET_MEDIA_MAX_BYTES",
                maxBytes: Number(event.target.value) * MB,
              })
            }
          >
            {[25, 50, 100, 250, 500].map((value) => (
              <option value={value} key={value}>
                {value} MB
              </option>
            ))}
          </select>
        </div>
      </footer>
    </main>
  );
}

function createDefaultClient(): PopupClient {
  return {
    async request(message) {
      const runtime = (
        globalThis as unknown as {
          chrome: {
            runtime: {
              sendMessage(message: RuntimeRequest): Promise<RuntimeResponse>;
            };
          };
        }
      ).chrome.runtime;
      const response = await runtime.sendMessage(message);
      if (!response.ok) throw new PopupError(response.errorCode);
      return response.data;
    },
    requestSitePermission(site) {
      return new SitePermissionService().request(site);
    },
    removeSitePermission(site) {
      return new SitePermissionService().remove(site);
    },
  };
}

class PopupError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function readErrorCode(error: unknown): string {
  return error instanceof PopupError ? error.code : "RUNTIME_FAILED";
}

function errorLabel(code: string): string {
  const labels: Record<string, string> = {
    OAUTH_CLIENT_ID_REQUIRED: "请先配置 Google OAuth Client ID",
    GOOGLE_AUTH_FAILED: "Google 授权未完成，请重新连接并完成最后一步",
    DRIVE_PERMISSION_DENIED: "Google Drive 拒绝访问，请重新授权 Drive 权限",
    DRIVE_NETWORK_FAILED: "无法访问 Google Drive，请检查网络后重试",
    DRIVE_CONNECT_FAILED: "Google Drive 连接失败，请重新授权后重试",
    DRIVE_NOT_CONNECTED: "Google Drive 尚未连接",
    SITE_PERMISSION_DENIED: "站点访问权限未授予",
    SITE_PERMISSION_REQUIRED: "需要站点访问权限",
    SITE_TAB_REQUIRED: "请先打开并登录对应站点",
    SITE_HTTP_429: "站点限流，稍后自动重试",
    DRIVE_RATE_LIMITED: "Google Drive 限流，稍后自动重试",
    DRIVE_AUTH_REQUIRED: "Google Drive 授权已失效，请重新连接",
    BRIDGE_REQUEST_FAILED: "网络波动，稍后自动重试",
    CLAUDE_ORG_REQUIRED: "未识别到 Claude Organization ID",
    SITE_SCHEMA_CHANGED: "站点接口结构已变化",
    SITE_LIST_FAILED: "会话列表读取失败，请重试",
    SITE_DETAIL_FAILED: "个别会话读取失败，请重试",
    SESSION_PREPARE_FAILED: "会话归档内容生成失败，请重试",
    DRIVE_WRITE_FAILED: "Google Drive 写入失败，请重试",
    SYNC_STATE_FAILED: "同步状态保存失败，请重试",
    MEDIA_TOO_LARGE: "附件超过大小上限",
    UPLOAD_VERIFICATION_FAILED: "Drive 写入提交失败，请重试",
    SYNC_FAILED: "同步内部错误，请重新加载扩展后重试",
    RUNTIME_FAILED: "操作失败，请重试",
  };
  return labels[code] ?? code;
}

function siteSubtitle(
  fullBackfill: boolean,
  status: AppState["status"][SiteId],
  domain: string,
): string {
  if (status.phase === "running") {
    if (status.archived === 0 && status.skipped === 0) return "正在同步";
    return `正在同步 · ${status.archived} 已归档 · ${status.skipped} 已跳过`;
  }
  if (status.phase === "needs-tab") return "等待登录标签页";
  if (status.phase === "needs-permission") return "等待访问权限";
  if (status.phase === "error") {
    const labels: Record<string, string> = {
      SITE_HTTP_429: "站点限流，稍后自动重试",
      DRIVE_RATE_LIMITED: "Google Drive 限流，稍后自动重试",
      DRIVE_AUTH_REQUIRED: "Google Drive 授权已失效，请重新连接",
      DRIVE_PERMISSION_DENIED: "Google Drive 拒绝访问，请重新授权 Drive 权限",
      BRIDGE_REQUEST_FAILED: "网络波动，稍后自动重试",
      SITE_SCHEMA_CHANGED: "会话解析失败",
      SITE_LIST_FAILED: "会话列表读取失败，请重试",
      SITE_DETAIL_FAILED: "个别会话读取失败，请重试",
      SESSION_PREPARE_FAILED: "会话归档内容生成失败，请重试",
      DRIVE_WRITE_FAILED: "Google Drive 写入失败，请重试",
      SYNC_STATE_FAILED: "同步状态保存失败，请重试",
      UPLOAD_VERIFICATION_FAILED: "Drive 写入提交失败，请重试",
      SYNC_FAILED: "同步内部错误，请重新加载扩展后重试",
    };
    const label = labels[status.errorCode ?? ""] ?? "同步异常";
    return status.archived > 0 || status.skipped > 0
      ? `${label} · ${status.archived} 已归档 · ${status.skipped} 已跳过`
      : label;
  }
  if (status.errorCode === "SYNC_INTERRUPTED") {
    return "上次同步中断，点击重试";
  }
  if (fullBackfill) return "全量待补";
  return domain;
}
