import type { NetworkObserverRegistration } from "../platform/network-observer-registration";
import type { SitePermissionService } from "../platform/site-permissions";
import type { StreamTurnCapture } from "../bridge/stream-capture";
import { SITE_IDS, type SiteId, type StateStore } from "../state/store";
import { SiteTaskCoordinator } from "../sync/site-task-coordinator";

interface NetworkObserverControllerOptions {
  store: Pick<StateStore, "get">;
  permissions: Pick<SitePermissionService, "isGranted">;
  registration: Pick<NetworkObserverRegistration, "setEnabled" | "reconcile">;
  syncSite(site: SiteId): Promise<void>;
  archiveFallback?(site: SiteId, capture: StreamTurnCapture): Promise<void>;
}

export class NetworkObserverController {
  readonly #coordinator = new SiteTaskCoordinator();

  constructor(private readonly options: NetworkObserverControllerOptions) {}

  async setEnabled(site: SiteId, enabled: boolean): Promise<void> {
    await this.options.registration.setEnabled(site, enabled);
  }

  handleCompletion(
    site: SiteId,
    capture?: StreamTurnCapture,
  ): Promise<boolean> {
    return this.#coordinator.run(site, async () => {
      const state = await this.options.store.get();
      if (!state.sites[site].enabled) return false;
      try {
        await this.options.syncSite(site);
      } catch (error) {
        if (capture && this.options.archiveFallback) {
          await this.options
            .archiveFallback(site, capture)
            .catch(() => undefined);
        }
        throw error;
      }
      return true;
    });
  }

  async reconcile(): Promise<void> {
    const state = await this.options.store.get();
    const enabledAndGranted: SiteId[] = [];
    for (const site of SITE_IDS) {
      if (
        state.sites[site].enabled &&
        (await this.options.permissions.isGranted(site))
      ) {
        enabledAndGranted.push(site);
      }
    }
    await this.options.registration.reconcile(enabledAndGranted);
  }
}
