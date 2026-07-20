import type { SiteId } from "../state/store";

export const SITE_ORIGINS: Record<SiteId, string> = {
  chatgpt: "https://chatgpt.com/*",
  claude: "https://claude.ai/*",
  gemini: "https://gemini.google.com/*",
  grok: "https://grok.com/*",
};

interface PermissionsApi {
  contains(permissions: { origins: string[] }): Promise<boolean>;
  request(permissions: { origins: string[] }): Promise<boolean>;
  remove(permissions: { origins: string[] }): Promise<boolean>;
}

export class SitePermissionService {
  constructor(
    private readonly api: PermissionsApi = (
      globalThis as unknown as { chrome: { permissions: PermissionsApi } }
    ).chrome.permissions,
  ) {}

  isGranted(site: SiteId): Promise<boolean> {
    return this.api.contains({ origins: [SITE_ORIGINS[site]] });
  }

  request(site: SiteId): Promise<boolean> {
    return this.api.request({ origins: [SITE_ORIGINS[site]] });
  }

  remove(site: SiteId): Promise<boolean> {
    return this.api.remove({ origins: [SITE_ORIGINS[site]] });
  }
}
