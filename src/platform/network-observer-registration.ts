import { SITE_IDS, type SiteId } from "../state/store";
import { SITE_ORIGINS } from "./site-permissions";

interface ScriptingApi {
  getRegisteredContentScripts(filter?: {
    ids?: string[];
  }): Promise<Array<Record<string, unknown>>>;
  registerContentScripts(
    scripts: Array<Record<string, unknown>>,
  ): Promise<void>;
  unregisterContentScripts(filter?: { ids?: string[] }): Promise<void>;
}

export class NetworkObserverRegistration {
  #queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly api: ScriptingApi) {}

  reconcile(enabledSites: readonly SiteId[]): Promise<void> {
    return this.#enqueue(async () => {
      const enabled = new Set(enabledSites);
      for (const site of SITE_IDS) {
        await this.#setEnabled(site, enabled.has(site));
      }
    });
  }

  setEnabled(site: SiteId, enabled: boolean): Promise<void> {
    return this.#enqueue(() => this.#setEnabled(site, enabled));
  }

  async #setEnabled(site: SiteId, enabled: boolean): Promise<void> {
    const ids = observerIds(site);
    const existing = await this.api.getRegisteredContentScripts({ ids });
    const registeredIds = ids.filter((id) =>
      existing.some((script) => script.id === id),
    );
    if (!enabled) {
      if (registeredIds.length > 0) {
        await this.api.unregisterContentScripts({ ids: registeredIds });
      }
      return;
    }
    if (registeredIds.length === ids.length) return;
    if (registeredIds.length > 0) {
      await this.api.unregisterContentScripts({ ids: registeredIds });
    }
    const shared = {
      matches: [SITE_ORIGINS[site]],
      runAt: "document_start",
      allFrames: false,
      persistAcrossSessions: true,
    };
    await this.api.registerContentScripts([
      {
        ...shared,
        id: ids[0],
        js: ["content-scripts/fetch-observer-main.js"],
        world: "MAIN",
      },
      {
        ...shared,
        id: ids[1],
        js: ["content-scripts/fetch-observer-relay.js"],
        world: "ISOLATED",
      },
    ]);
  }

  #enqueue(operation: () => Promise<void>): Promise<void> {
    const queued = this.#queue.then(operation);
    this.#queue = queued.catch(() => undefined);
    return queued;
  }
}

function observerIds(site: SiteId): [string, string] {
  return [
    `brain-capture-observer-main-${site}`,
    `brain-capture-observer-relay-${site}`,
  ];
}
