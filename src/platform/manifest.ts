import type { UserManifest } from "wxt";

export const DEVELOPMENT_OAUTH_CLIENT_ID =
  "brain-capture-development.apps.googleusercontent.com";

export const DEVELOPMENT_EXTENSION_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3Oy0AcstQ3ENKxI+eHPJM0D7dTjAEL2/FJMyaGPdz+Rws0PDJmG8zj772q6TPrIwdmR7w7zEJVVDPZvch49E1cQRZPT8SXfzQSW9jX8g/GZKNbgo7+OwmUW76mWmylgNeo5+3ApJ7bR0pgvU7v5oCUM6nOOMCKsTt4SQcJQi0BHB7zPgGTaeVJyZixpwiMeX8cxH9fw59P+62+34zHIW38dXmhlLN0sUm1MsYJeV+tMEug0ukmZLRMpCaDDKbXR/OLyKZCG+PEivneKtOPPOJID1dnPehK1wuPCgJGrSfNTRjUOdsFKcp9aAM1DKXtXOcl9ksWP9WI7l6hzn1WjemQIDAQAB";

type ManifestOptions = {
  extensionKey?: string | null;
};

export function createManifest(
  oauthClientId: string,
  options: ManifestOptions = {},
): UserManifest {
  const extensionKey =
    options.extensionKey === undefined
      ? DEVELOPMENT_EXTENSION_KEY
      : options.extensionKey;
  return {
    name: "BrainHub Capture",
    short_name: "BrainHub",
    description: "将网页 AI 会话和手动精选文本归档到个人 BrainHub。",
    minimum_chrome_version: "120",
    icons: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
    action: {
      default_title: "BrainHub Capture",
      default_icon: {
        16: "icons/icon-16.png",
        32: "icons/icon-32.png",
      },
    },
    permissions: [
      "alarms",
      "contextMenus",
      "identity",
      "notifications",
      "offscreen",
      "scripting",
      "storage",
    ],
    host_permissions: [
      "https://www.googleapis.com/*",
      "https://oauth2.googleapis.com/*",
    ],
    optional_host_permissions: [
      "https://chatgpt.com/*",
      "https://claude.ai/*",
      "https://gemini.google.com/*",
      "https://grok.com/*",
    ],
    oauth2: {
      client_id: oauthClientId,
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    },
    ...(extensionKey ? { key: extensionKey } : {}),
  };
}

export const wxtManifest = createManifest(DEVELOPMENT_OAUTH_CLIENT_ID);

export const manifestDefinition = {
  manifest_version: 3 as const,
  ...wxtManifest,
};
