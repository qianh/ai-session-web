import { describe, expect, it, vi } from "vitest";

import { SitePermissionService } from "../../../src/platform/site-permissions";

describe("SitePermissionService", () => {
  it("requests and removes only the selected site's origin", async () => {
    const api = {
      contains: vi.fn(async () => false),
      request: vi.fn(async () => true),
      remove: vi.fn(async () => true),
    };
    const permissions = new SitePermissionService(api);

    await expect(permissions.isGranted("grok")).resolves.toBe(false);
    await expect(permissions.request("grok")).resolves.toBe(true);
    await expect(permissions.remove("grok")).resolves.toBe(true);
    expect(api.request).toHaveBeenCalledWith({
      origins: ["https://grok.com/*"],
    });
    expect(api.remove).toHaveBeenCalledWith({
      origins: ["https://grok.com/*"],
    });
  });
});
