import { describe, expect, it } from "vitest";

import {
  auditManifest,
  requiredRuntimeFiles,
} from "../../scripts/audit-build.mjs";
import { createManifest } from "../../src/platform/manifest";

function validManifest(
  clientId = "brain-capture-development.apps.googleusercontent.com",
) {
  const base = createManifest(clientId);
  return {
    ...base,
    manifest_version: 3,
    background: { service_worker: "background.js" },
    action: { ...base.action, default_popup: "popup.html" },
  };
}

describe("build artifact audit", () => {
  it("accepts the exact development manifest contract", () => {
    expect(auditManifest(validManifest(), { release: false })).toEqual([]);
  });

  it("rejects a placeholder OAuth ID in a release artifact", () => {
    expect(auditManifest(validManifest(), { release: true })).toContain(
      "正式包仍在使用占位 OAuth Client ID",
    );
  });

  it("requires only the narrow Drive API host access", () => {
    const manifestWithoutDriveHost = validManifest(
      "real-client.apps.googleusercontent.com",
    );
    delete manifestWithoutDriveHost.host_permissions;
    expect(
      auditManifest(manifestWithoutDriveHost, { release: true }),
    ).toContain("host_permissions 必须仅允许 Google Drive API");
    expect(
      auditManifest(
        {
          ...validManifest("real-client.apps.googleusercontent.com"),
          host_permissions: ["https://*/*"],
        },
        { release: true },
      ),
    ).toContain("host_permissions 必须仅允许 Google Drive API");
  });

  it("requires both runtime observer bundles", () => {
    expect(requiredRuntimeFiles).toEqual(
      expect.arrayContaining([
        "content-scripts/fetch-observer-main.js",
        "content-scripts/fetch-observer-relay.js",
      ]),
    );
  });
});
