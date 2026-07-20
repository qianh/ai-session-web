import { describe, expect, it, vi } from "vitest";

import { NetworkObserverRegistration } from "../../../src/platform/network-observer-registration";

describe("NetworkObserverRegistration", () => {
  it("skips unregistering observer scripts that Chrome has not registered", async () => {
    const api = {
      getRegisteredContentScripts: vi.fn(async () => []),
      registerContentScripts: vi.fn(async () => undefined),
      unregisterContentScripts: vi.fn(
        async ({ ids }: { ids?: string[] } = {}) => {
          throw new Error(`Nonexistent script ID '${ids?.[0]}'`);
        },
      ),
    };
    const registration = new NetworkObserverRegistration(api);

    await expect(registration.reconcile([])).resolves.toBeUndefined();

    expect(api.unregisterContentScripts).not.toHaveBeenCalled();
  });

  it("registers and unregisters exactly two persistent scripts per site", async () => {
    let registered: Array<Record<string, unknown>> = [];
    const api = {
      getRegisteredContentScripts: vi.fn(
        async ({ ids }: { ids?: string[] } = {}) =>
          ids
            ? registered.filter((script) => ids.includes(String(script.id)))
            : registered,
      ),
      registerContentScripts: vi.fn(
        async (scripts: Array<Record<string, unknown>>) => {
          registered.push(...scripts);
        },
      ),
      unregisterContentScripts: vi.fn(
        async ({ ids }: { ids?: string[] } = {}) => {
          registered = ids
            ? registered.filter((script) => !ids.includes(String(script.id)))
            : [];
        },
      ),
    };
    const registration = new NetworkObserverRegistration(api);

    await registration.setEnabled("grok", true);

    expect(api.registerContentScripts).toHaveBeenCalledOnce();
    expect(registered).toEqual([
      {
        id: "brain-capture-observer-main-grok",
        js: ["content-scripts/fetch-observer-main.js"],
        matches: ["https://grok.com/*"],
        runAt: "document_start",
        world: "MAIN",
        allFrames: false,
        persistAcrossSessions: true,
      },
      {
        id: "brain-capture-observer-relay-grok",
        js: ["content-scripts/fetch-observer-relay.js"],
        matches: ["https://grok.com/*"],
        runAt: "document_start",
        world: "ISOLATED",
        allFrames: false,
        persistAcrossSessions: true,
      },
    ]);

    await registration.setEnabled("grok", true);
    expect(api.registerContentScripts).toHaveBeenCalledOnce();

    await registration.setEnabled("grok", false);
    expect(api.unregisterContentScripts).toHaveBeenLastCalledWith({
      ids: [
        "brain-capture-observer-main-grok",
        "brain-capture-observer-relay-grok",
      ],
    });
    expect(registered).toEqual([]);
  });

  it("serializes concurrent registrations for the same site", async () => {
    let registered: Array<Record<string, unknown>> = [];
    const api = {
      getRegisteredContentScripts: vi.fn(
        async ({ ids }: { ids?: string[] } = {}) =>
          ids
            ? registered.filter((script) => ids.includes(String(script.id)))
            : registered,
      ),
      registerContentScripts: vi.fn(
        async (scripts: Array<Record<string, unknown>>) => {
          const duplicate = scripts.find((candidate) =>
            registered.some((script) => script.id === candidate.id),
          );
          if (duplicate)
            throw new Error(`Duplicate script ID '${duplicate.id}'`);
          registered.push(...scripts);
        },
      ),
      unregisterContentScripts: vi.fn(async () => {
        registered = [];
      }),
    };
    const registration = new NetworkObserverRegistration(api);

    await expect(
      Promise.all([
        registration.setEnabled("chatgpt", true),
        registration.setEnabled("chatgpt", true),
      ]),
    ).resolves.toEqual([undefined, undefined]);

    expect(api.registerContentScripts).toHaveBeenCalledOnce();
    expect(registered).toHaveLength(2);
  });

  it("reconciles stale persistent registrations after a worker restart", async () => {
    let registered: Array<Record<string, unknown>> = [];
    const api = {
      getRegisteredContentScripts: vi.fn(
        async ({ ids }: { ids?: string[] } = {}) =>
          ids
            ? registered.filter((script) => ids.includes(String(script.id)))
            : registered,
      ),
      registerContentScripts: vi.fn(
        async (scripts: Array<Record<string, unknown>>) => {
          registered.push(...scripts);
        },
      ),
      unregisterContentScripts: vi.fn(
        async ({ ids }: { ids?: string[] } = {}) => {
          registered = ids
            ? registered.filter((script) => !ids.includes(String(script.id)))
            : [];
        },
      ),
    };
    const registration = new NetworkObserverRegistration(api);
    await registration.setEnabled("chatgpt", true);
    await registration.setEnabled("grok", true);

    await registration.reconcile(["chatgpt"]);

    expect(registered.map((script) => script.id)).toEqual([
      "brain-capture-observer-main-chatgpt",
      "brain-capture-observer-relay-chatgpt",
    ]);
  });
});
