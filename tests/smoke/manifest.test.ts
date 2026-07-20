import { describe, expect, it } from "vitest";

import {
  createManifest,
  DEVELOPMENT_OAUTH_CLIENT_ID,
  manifestDefinition,
} from "../../src/platform/manifest";

describe("Chrome manifest contract", () => {
  it("uses only the required MV3 platform permissions", () => {
    expect(manifestDefinition.manifest_version).toBe(3);
    expect(manifestDefinition.permissions).toEqual([
      "alarms",
      "identity",
      "offscreen",
      "scripting",
      "storage",
    ]);
  });

  it("keeps persistent host access limited to the Drive API", () => {
    expect(manifestDefinition.host_permissions).toEqual([
      "https://www.googleapis.com/*",
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
    expect(manifestDefinition.key).toMatch(/^[A-Za-z0-9+/]+=*$/);
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
