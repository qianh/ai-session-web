import { defineConfig } from "wxt";

import {
  createManifest,
  DEVELOPMENT_OAUTH_CLIENT_ID,
} from "./src/platform/manifest";

const runtimeProcess = (
  globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>;
      loadEnvFile?(path?: string): void;
    };
  }
).process;

try {
  runtimeProcess?.loadEnvFile?.(".env.local");
} catch {
  // Local OAuth configuration is optional for development builds.
}

const oauthClientId =
  runtimeProcess?.env?.WXT_GOOGLE_OAUTH_CLIENT_ID ??
  DEVELOPMENT_OAUTH_CLIENT_ID;
const storeBootstrap = runtimeProcess?.env?.WXT_STORE_BOOTSTRAP === "1";
const extensionKey = storeBootstrap
  ? null
  : runtimeProcess?.env?.WXT_EXTENSION_PUBLIC_KEY?.trim() || undefined;

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: createManifest(
    oauthClientId,
    extensionKey === undefined ? {} : { extensionKey },
  ),
});
