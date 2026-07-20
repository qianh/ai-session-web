import { describe, expect, it, vi } from "vitest";

import { ChromeTokenProvider } from "../../../src/drive/chrome-auth";

describe("ChromeTokenProvider", () => {
  it("returns a non-interactive cached Drive token for background sync", async () => {
    const getAuthToken = vi.fn(async () => ({ token: "drive-token" }));
    const provider = new ChromeTokenProvider({
      getAuthToken,
      removeCachedAuthToken: vi.fn(),
    });

    await expect(provider.getToken()).resolves.toBe("drive-token");
    expect(getAuthToken).toHaveBeenCalledWith({ interactive: false });
  });

  it("only opens the consent flow through an explicit connect call", async () => {
    const getAuthToken = vi.fn(async () => ({ token: "drive-token" }));
    const provider = new ChromeTokenProvider({
      getAuthToken,
      removeCachedAuthToken: vi.fn(),
    });

    await expect(provider.connect()).resolves.toBe("drive-token");
    expect(getAuthToken).toHaveBeenCalledWith({ interactive: true });
  });

  it("reuses the interactive token for the first Drive request", async () => {
    const getAuthToken = vi.fn(async () => ({ token: "drive-token" }));
    const provider = new ChromeTokenProvider({
      getAuthToken,
      removeCachedAuthToken: vi.fn(),
    });

    await expect(provider.connect()).resolves.toBe("drive-token");
    await expect(provider.getToken()).resolves.toBe("drive-token");

    expect(getAuthToken).toHaveBeenCalledOnce();
  });

  it("evicts rejected tokens and rejects empty responses", async () => {
    const removeCachedAuthToken = vi.fn(async () => undefined);
    const provider = new ChromeTokenProvider({
      getAuthToken: vi.fn(async () => ({})),
      removeCachedAuthToken,
    });

    await provider.invalidate("expired");
    await expect(provider.getToken()).rejects.toThrow("authorization");
    expect(removeCachedAuthToken).toHaveBeenCalledWith({ token: "expired" });
  });
});
