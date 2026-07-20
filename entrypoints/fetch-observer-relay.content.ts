import { createObserverRelay } from "../src/bridge/observer-relay";
import { browser } from "wxt/browser";

export default defineContentScript({
  registration: "runtime",
  world: "ISOLATED",
  runAt: "document_start",
  noScriptStartedPostMessage: true,
  main(ctx) {
    const relay = createObserverRelay({
      source: window,
      origin: location.origin,
      send: (message) => browser.runtime.sendMessage(message),
    });
    ctx.addEventListener(window, "message", (event) => {
      relay(event);
    });
  },
});
