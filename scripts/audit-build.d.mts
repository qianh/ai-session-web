export const requiredRuntimeFiles: string[];

export function auditManifest(
  manifest: unknown,
  options?: {
    release?: boolean;
    storeBootstrap?: boolean;
    expectedOauthClientId?: string;
    expectedExtensionId?: string;
  },
): string[];
