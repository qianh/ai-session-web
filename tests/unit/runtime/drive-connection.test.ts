import { describe, expect, it, vi } from "vitest";

import { DriveApiError } from "../../../src/drive/rest-client";
import { DEVELOPMENT_OAUTH_CLIENT_ID } from "../../../src/platform/manifest";
import { DriveConnectionService } from "../../../src/runtime/drive-connection";
import { createDefaultState } from "../../../src/state/store";

describe("DriveConnectionService", () => {
  it("rejects the development Client ID before opening OAuth", async () => {
    const connect = vi.fn();
    const service = new DriveConnectionService({
      oauthClientId: DEVELOPMENT_OAUTH_CLIENT_ID,
      tokenProvider: { connect },
      drive: { listFolders: vi.fn(), createFolder: vi.fn() },
      store: { get: vi.fn(), update: vi.fn() },
      now: () => new Date(),
    });

    await expect(service.connect()).rejects.toMatchObject({
      code: "OAUTH_CLIENT_ID_REQUIRED",
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it("connects interactively, creates brain-hub, and saves only the root ID", async () => {
    let state = createDefaultState("device-test");
    const update = vi.fn(async (mutate) => {
      state = mutate(structuredClone(state));
      return structuredClone(state);
    });
    const service = new DriveConnectionService({
      oauthClientId: "real-client.apps.googleusercontent.com",
      tokenProvider: { connect: vi.fn(async () => "drive-token") },
      drive: {
        listFolders: vi.fn(async () => []),
        createFolder: vi.fn(async () => ({
          id: "root-id",
          name: "brain-hub",
          mimeType: "application/vnd.google-apps.folder",
        })),
      },
      store: { get: vi.fn(async () => state), update },
      now: () => new Date("2026-07-19T01:00:00.000Z"),
    });

    await expect(service.connect()).resolves.toBe("root-id");
    expect(state.drive).toEqual({
      status: "connected",
      rootFolderId: "root-id",
      connectedAt: "2026-07-19T01:00:00.000Z",
    });
    expect(JSON.stringify(state)).not.toContain("drive-token");
  });

  it("reports an OAuth-stage failure when interactive authorization is rejected", async () => {
    let state = createDefaultState("device-test");
    const update = vi.fn(async (mutate) => {
      state = mutate(structuredClone(state));
      return structuredClone(state);
    });
    const listFolders = vi.fn();
    const service = new DriveConnectionService({
      oauthClientId: "real-client.apps.googleusercontent.com",
      tokenProvider: {
        connect: vi.fn(async () => {
          throw new Error("OAuth2 request failed: access_denied");
        }),
      },
      drive: { listFolders, createFolder: vi.fn() },
      store: { get: vi.fn(async () => state), update },
    });

    await expect(service.connect()).rejects.toMatchObject({
      code: "GOOGLE_AUTH_FAILED",
    });

    expect(state.drive).toMatchObject({
      status: "error",
      errorCode: "GOOGLE_AUTH_FAILED",
      diagnostic: {
        stage: "oauth",
        name: "Error",
        message: "OAuth2 request failed: access_denied",
      },
    });
    expect(listFolders).not.toHaveBeenCalled();
  });

  it("reports a Drive permission failure when the API returns 403", async () => {
    let state = createDefaultState("device-test");
    const update = vi.fn(async (mutate) => {
      state = mutate(structuredClone(state));
      return structuredClone(state);
    });
    const service = new DriveConnectionService({
      oauthClientId: "real-client.apps.googleusercontent.com",
      tokenProvider: { connect: vi.fn(async () => "drive-token") },
      drive: {
        listFolders: vi.fn(async () => {
          throw new DriveApiError(403, false);
        }),
        createFolder: vi.fn(),
      },
      store: { get: vi.fn(async () => state), update },
    });

    await expect(service.connect()).rejects.toMatchObject({
      code: "DRIVE_PERMISSION_DENIED",
    });
    expect(state.drive).toMatchObject({
      status: "error",
      errorCode: "DRIVE_PERMISSION_DENIED",
    });
  });

  it("reports a Drive network failure when the API cannot be reached", async () => {
    let state = createDefaultState("device-test");
    const update = vi.fn(async (mutate) => {
      state = mutate(structuredClone(state));
      return structuredClone(state);
    });
    const service = new DriveConnectionService({
      oauthClientId: "real-client.apps.googleusercontent.com",
      tokenProvider: { connect: vi.fn(async () => "drive-token") },
      drive: {
        listFolders: vi.fn(async () => {
          throw new TypeError("Failed to fetch Bearer secret-token-123");
        }),
        createFolder: vi.fn(),
      },
      store: { get: vi.fn(async () => state), update },
    });

    await expect(service.connect()).rejects.toMatchObject({
      code: "DRIVE_NETWORK_FAILED",
    });
    expect(state.drive).toMatchObject({
      status: "error",
      errorCode: "DRIVE_NETWORK_FAILED",
      diagnostic: {
        stage: "drive-root",
        name: "TypeError",
        message: "Failed to fetch Bearer [redacted]",
      },
    });
  });
});
