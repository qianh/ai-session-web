import { describe, expect, it } from "vitest";

import {
  createManifest,
  DEVELOPMENT_EXTENSION_KEY,
  DEVELOPMENT_OAUTH_CLIENT_ID,
  manifestDefinition,
} from "../../src/platform/manifest";

describe("Chrome manifest contract", () => {
  it("uses the public BrainHub Capture product name", () => {
    expect(manifestDefinition.name).toBe("BrainHub Capture");
    expect(manifestDefinition.short_name).toBe("BrainHub");
    expect(manifestDefinition.action?.default_title).toBe("BrainHub Capture");
  });

  it("describes both automatic sessions and manual highlights", () => {
    expect(manifestDefinition.description).toBe(
      "将网页 AI 会话和手动精选文本归档到个人 BrainHub。",
    );
  });

  it("uses only the required MV3 platform permissions", () => {
    expect(manifestDefinition.manifest_version).toBe(3);
    expect(manifestDefinition.permissions).toEqual([
      "alarms",
      "contextMenus",
      "identity",
      "notifications",
      "offscreen",
      "scripting",
      "storage",
    ]);
  });

  it("keeps persistent host access limited to Drive and OAuth revocation", () => {
    expect(manifestDefinition.host_permissions).toEqual([
      "https://www.googleapis.com/*",
      "https://oauth2.googleapis.com/*",
    ]);
    expect(manifestDefinition.optional_host_permissions).toEqual([
      "https://chatgpt.com/*",
      "https://claude.ai/*",
      "https://gemini.google.com/*",
      "https://grok.com/*",
    ]);
  });

  it("uses the narrow Drive scope and a stable extension key", () => {
    expect(manifestDefinition.oauth2?.scopes).toEqual([
      "https://www.googleapis.com/auth/drive.file",
    ]);
    expect(manifestDefinition.oauth2?.client_id).toMatch(
      /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/,
    );
    expect(manifestDefinition.key).toBe(DEVELOPMENT_EXTENSION_KEY);
  });

  it("can omit the key for the first unpublished Web Store upload", () => {
    expect(
      createManifest(DEVELOPMENT_OAUTH_CLIENT_ID, { extensionKey: null }).key,
    ).toBeUndefined();
  });

  it("ships local toolbar and extension icons", () => {
    expect(manifestDefinition.icons).toEqual({
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    });
    expect(manifestDefinition.action?.default_icon).toEqual({
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
    });
  });

  it("allows release builds to inject the real OAuth Client ID", () => {
    expect(manifestDefinition.oauth2?.client_id).toBe(
      DEVELOPMENT_OAUTH_CLIENT_ID,
    );
    expect(
      createManifest("real-client.apps.googleusercontent.com").oauth2
        ?.client_id,
    ).toBe("real-client.apps.googleusercontent.com");
  });
});
