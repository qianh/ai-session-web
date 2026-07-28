import type { UserManifest } from "wxt";

export const DEVELOPMENT_OAUTH_CLIENT_ID =
  "brain-capture-development.apps.googleusercontent.com";

export const DEVELOPMENT_EXTENSION_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuwnZEk0zcRinly/NuJU+4i8Nnv4NlQknY3oDxayE96kaj+KBcRcuocHmjXwwpOMfOclldrXQCUEv6uHq6TDocMUCRHAC8lB33KZA6G+ZV19Cz+mvJuo4//OasAc5SnvRr02k9XdxjfUmt8/Rs+cMGK0/Y/BLK7jw/U7rMo19nO1b6zsIS1rru5cEuOhvVz16aua52oMVwVirqj5ARHh9HXVPtPXZgBEDx2uDZvFGvM5D1UMW9y71APJtyeK468y0BcGTTro6ACfC+jAazEIg+q3j+QPDhgqjo7b14tvwrzwON7FOYnsPV3XKqVxfzLg8dKjah+Izxbzex6Cxsr6pAwIDAQAB";

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
