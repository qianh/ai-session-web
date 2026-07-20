export const requiredRuntimeFiles: string[];

export function auditManifest(
  manifest: unknown,
  options?: {
    release?: boolean;
    expectedOauthClientId?: string;
  },
): string[];
