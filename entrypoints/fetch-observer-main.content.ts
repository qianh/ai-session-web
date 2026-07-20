import {
  installFetchObserver,
  installXmlHttpRequestObserver,
  installWebSocketObserver,
  siteUsesWebSocketObserver,
} from "../src/bridge/network-observer";
import { createObserverMessage } from "../src/bridge/observer-message";
import { SITE_ORIGINS } from "../src/platform/site-permissions";
import type { SiteId } from "../src/state/store";
import type { StreamTurnCapture } from "../src/bridge/stream-capture";

export default defineContentScript({
  registration: "runtime",
  world: "MAIN",
  runAt: "document_start",
  noScriptStartedPostMessage: true,
  main() {
    const site = (Object.keys(SITE_ORIGINS) as SiteId[]).find(
      (candidate) =>
        new URL(SITE_ORIGINS[candidate]).origin === location.origin,
    );
    if (!site) return;
    const signal = (_site: SiteId, capture?: StreamTurnCapture) => {
      window.postMessage(createObserverMessage(site, capture), location.origin);
    };
    const sourceUrl = () => location.href;
    installFetchObserver({
      site,
      target: globalThis,
      signal,
      sourceUrl,
    });
    if (site === "gemini") {
      installXmlHttpRequestObserver({
        site,
        target: globalThis,
        signal,
        sourceUrl,
      });
    }
    if (siteUsesWebSocketObserver(site)) {
      installWebSocketObserver({
        site,
        target: globalThis,
        signal,
        sourceUrl,
      });
    }
  },
});
