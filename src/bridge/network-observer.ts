import type { SiteId } from "../state/store";
import {
  ChatGptStreamAccumulator,
  GrokStreamAccumulator,
  parseClaudeStreamCapture,
  parseGeminiStreamCapture,
  type StreamTurnCapture,
} from "./stream-capture";

export interface ObservedFetchRequest {
  site: SiteId;
  url: string;
  method: string;
  body?: unknown;
}

interface FetchObserverTarget {
  fetch: typeof globalThis.fetch;
}

interface XmlHttpRequestObserverTarget {
  XMLHttpRequest: typeof globalThis.XMLHttpRequest;
}

interface FetchObserverOptions {
  site: SiteId;
  target: FetchObserverTarget;
  signal(site: SiteId, capture?: StreamTurnCapture): void;
  sourceUrl?: () => string;
  now?: () => string;
  maxCaptureBytes?: number;
}

interface XmlHttpRequestObserverOptions {
  site: SiteId;
  target: XmlHttpRequestObserverTarget;
  signal(site: SiteId, capture?: StreamTurnCapture): void;
  sourceUrl?: () => string;
  now?: () => string;
  maxCaptureBytes?: number;
}

const FETCH_OBSERVER_MARKER = Symbol.for("brain-capture.fetch-observer.v1");
const XHR_OBSERVER_MARKER = Symbol.for("brain-capture.xhr-observer.v1");
const WEBSOCKET_OBSERVER_MARKER = Symbol.for(
  "brain-capture.websocket-observer.v1",
);

interface WebSocketObserverTarget {
  WebSocket: typeof globalThis.WebSocket;
}

interface WebSocketObserverOptions {
  site: SiteId;
  target: WebSocketObserverTarget;
  signal(site: SiteId, capture?: StreamTurnCapture): void;
  sourceUrl?: () => string;
  now?: () => string;
  maxCaptureBytes?: number;
  idleMs?: number;
}

export function installWebSocketObserver(options: WebSocketObserverOptions): {
  uninstall(): void;
} {
  const markedTarget = options.target as WebSocketObserverTarget &
    Record<PropertyKey, unknown>;
  if (markedTarget[WEBSOCKET_OBSERVER_MARKER] !== undefined) {
    return { uninstall() {} };
  }
  const original = options.target.WebSocket;
  const idleMs = options.idleMs ?? 2_500;
  const observed = new Proxy(original, {
    construct(target, argumentsList, newTarget) {
      const socket = Reflect.construct(
        target,
        argumentsList,
        newTarget,
      ) as WebSocket;
      const url = String(argumentsList[0] ?? "");
      if (shouldObserveWebSocket(options.site, url)) {
        const accumulator = options.sourceUrl
          ? options.site === "chatgpt"
            ? new ChatGptStreamAccumulator({
                sourceUrl: options.sourceUrl,
                ...(options.now ? { now: options.now } : {}),
                ...(options.maxCaptureBytes === undefined
                  ? {}
                  : { maxBytes: options.maxCaptureBytes }),
              })
            : new GrokStreamAccumulator({
                sourceUrl: options.sourceUrl,
                ...(options.now ? { now: options.now } : {}),
                ...(options.maxCaptureBytes === undefined
                  ? {}
                  : { maxBytes: options.maxCaptureBytes }),
              })
          : undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let completed = false;
        socket.addEventListener("message", (event) => {
          const capture =
            accumulator && typeof event.data === "string"
              ? accumulator.push(event.data)
              : undefined;
          const state = classifyWebSocketMessage(options.site, event.data);
          if (state === "ignore") return;
          if (completed && state === "progress") return;
          if (state === "start") completed = false;
          if (timer !== undefined) clearTimeout(timer);
          if (state === "complete") {
            timer = undefined;
            completed = true;
            signalSafely(options, capture);
            return;
          }
          timer = setTimeout(() => {
            timer = undefined;
            completed = true;
            signalSafely(options);
          }, idleMs);
        });
        socket.addEventListener("close", () => {
          if (timer !== undefined) clearTimeout(timer);
          timer = undefined;
        });
      }
      return socket;
    },
  });
  options.target.WebSocket = observed;
  markedTarget[WEBSOCKET_OBSERVER_MARKER] = observed;
  return {
    uninstall() {
      if (
        options.target.WebSocket === observed &&
        markedTarget[WEBSOCKET_OBSERVER_MARKER] === observed
      ) {
        options.target.WebSocket = original;
        delete markedTarget[WEBSOCKET_OBSERVER_MARKER];
      }
    },
  };
}

function signalSafely(
  options: WebSocketObserverOptions,
  capture?: StreamTurnCapture,
): void {
  try {
    if (capture) options.signal(options.site, capture);
    else options.signal(options.site);
  } catch {
    // Observing must never alter the page's WebSocket behavior.
  }
}

function classifyWebSocketMessage(
  site: SiteId,
  data: unknown,
): "ignore" | "start" | "progress" | "complete" {
  if (typeof data !== "string") return "start";
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return "start";
  }
  if (site === "chatgpt") {
    const events = Array.isArray(parsed) ? parsed : [parsed];
    let sawProgress = false;
    for (const candidate of events) {
      if (!isRecord(candidate) || !isRecord(candidate.payload)) continue;
      const type = candidate.payload.type;
      if (type === "conversation-turn-complete") return "complete";
      if (type === "conversation-turn-stream") sawProgress = true;
    }
    return sawProgress ? "start" : "ignore";
  }
  if (site === "grok" && isRecord(parsed) && isRecord(parsed.event)) {
    const type = parsed.event.type;
    if (type === "response.persisted") return "complete";
    if (type === "response.created") return "start";
    if (
      typeof type === "string" &&
      (type.startsWith("response.") || type === "conversation.item.added")
    ) {
      return "progress";
    }
    return "ignore";
  }
  return "ignore";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function installFetchObserver(options: FetchObserverOptions): {
  uninstall(): void;
} {
  const markedTarget = options.target as FetchObserverTarget &
    Record<PropertyKey, unknown>;
  if (markedTarget[FETCH_OBSERVER_MARKER] !== undefined) {
    return { uninstall() {} };
  }
  const originalFetch = options.target.fetch;
  const observedFetch: typeof globalThis.fetch = async (input, init) => {
    const request = describeFetch(options.site, input, init);
    const response = await originalFetch.call(options.target, input, init);
    if (response.ok && shouldObserveFetch(request)) {
      try {
        const clone = response.clone();
        void readBoundedResponse(
          clone,
          options.maxCaptureBytes ?? 1024 * 1024,
        ).then(
          (responseText) => {
            const capture =
              responseText === undefined
                ? undefined
                : captureFetchResponse(options, request, responseText);
            if (capture) options.signal(options.site, capture);
            else options.signal(options.site);
          },
          () => undefined,
        );
      } catch {
        // Observing must never alter the page's fetch behavior.
      }
    }
    return response;
  };
  options.target.fetch = observedFetch;
  markedTarget[FETCH_OBSERVER_MARKER] = observedFetch;
  return {
    uninstall() {
      if (
        options.target.fetch === observedFetch &&
        markedTarget[FETCH_OBSERVER_MARKER] === observedFetch
      ) {
        options.target.fetch = originalFetch;
        delete markedTarget[FETCH_OBSERVER_MARKER];
      }
    },
  };
}

export function installXmlHttpRequestObserver(
  options: XmlHttpRequestObserverOptions,
): { uninstall(): void } {
  const markedTarget = options.target as XmlHttpRequestObserverTarget &
    Record<PropertyKey, unknown>;
  if (markedTarget[XHR_OBSERVER_MARKER] !== undefined) {
    return { uninstall() {} };
  }
  const original = options.target.XMLHttpRequest;
  const observed = new Proxy(original, {
    construct(target, argumentsList, newTarget) {
      const xhr = Reflect.construct(
        target,
        argumentsList,
        newTarget,
      ) as XMLHttpRequest;
      const originalOpen = xhr.open;
      const originalSend = xhr.send;
      let request: ObservedFetchRequest | undefined;
      const observedOpen = (
        ...args: [string, string | URL, boolean?, string?, string?]
      ) => {
        request = describeFetch(options.site, args[1], { method: args[0] });
        return Reflect.apply(originalOpen, xhr, args);
      };
      const observedSend = (
        body?: Document | XMLHttpRequestBodyInit | null,
      ) => {
        const completedRequest = request
          ? {
              ...request,
              ...(body === undefined ? {} : { body }),
            }
          : undefined;
        if (completedRequest && shouldObserveFetch(completedRequest)) {
          xhr.addEventListener(
            "loadend",
            () => {
              if (xhr.status < 200 || xhr.status >= 300) return;
              try {
                const responseText =
                  xhr.responseType === "" || xhr.responseType === "text"
                    ? xhr.responseText
                    : undefined;
                const capture =
                  responseText === undefined
                    ? undefined
                    : captureFetchResponse(
                        options,
                        completedRequest,
                        responseText,
                      );
                if (capture) options.signal(options.site, capture);
                else options.signal(options.site);
              } catch {
                // Observing must never alter the page's XHR behavior.
              }
            },
            { once: true },
          );
        }
        return Reflect.apply(
          originalSend,
          xhr,
          body === undefined ? [] : [body],
        );
      };
      Object.defineProperties(xhr, {
        open: { configurable: true, value: observedOpen },
        send: { configurable: true, value: observedSend },
      });
      return xhr;
    },
  });
  options.target.XMLHttpRequest = observed;
  markedTarget[XHR_OBSERVER_MARKER] = observed;
  return {
    uninstall() {
      if (
        options.target.XMLHttpRequest === observed &&
        markedTarget[XHR_OBSERVER_MARKER] === observed
      ) {
        options.target.XMLHttpRequest = original;
        delete markedTarget[XHR_OBSERVER_MARKER];
      }
    },
  };
}

function describeFetch(
  site: SiteId,
  input: RequestInfo | URL,
  init?: RequestInit,
): ObservedFetchRequest {
  const request =
    typeof Request !== "undefined" && input instanceof Request
      ? input
      : undefined;
  const rawUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : (request?.url ?? String(input));
  const base = {
    chatgpt: "https://chatgpt.com",
    claude: "https://claude.ai",
    gemini: "https://gemini.google.com",
    grok: "https://grok.com",
  }[site];
  let url = rawUrl;
  try {
    url = new URL(rawUrl, base).href;
  } catch {
    // The request matcher will reject malformed URLs.
  }
  return {
    site,
    url,
    method: init?.method ?? request?.method ?? "GET",
    ...(init?.body === undefined ? {} : { body: init.body }),
  };
}

async function readBoundedResponse(
  response: Response,
  maxBytes: number,
): Promise<string | undefined> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  let overflowed = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (!overflowed) parts.push(decoder.decode());
      return overflowed ? undefined : parts.join("");
    }
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      overflowed = true;
      parts.length = 0;
    } else if (!overflowed) {
      parts.push(decoder.decode(value, { stream: true }));
    }
  }
}

function captureFetchResponse(
  options: FetchObserverOptions | XmlHttpRequestObserverOptions,
  request: ObservedFetchRequest,
  responseText: string,
): StreamTurnCapture | undefined {
  if (!options.sourceUrl) return undefined;
  const requestBody =
    typeof request.body === "string"
      ? request.body
      : request.body instanceof URLSearchParams
        ? request.body.toString()
        : undefined;
  if (requestBody === undefined) return undefined;
  const input = {
    requestUrl: request.url,
    requestBody,
    responseText,
    sourceUrl: options.sourceUrl(),
    observedAt: (options.now ?? (() => new Date().toISOString()))(),
    ...(options.maxCaptureBytes === undefined
      ? {}
      : { maxBytes: options.maxCaptureBytes }),
  };
  if (options.site === "claude") return parseClaudeStreamCapture(input);
  if (options.site === "gemini") return parseGeminiStreamCapture(input);
  return undefined;
}

export function shouldObserveFetch(request: ObservedFetchRequest): boolean {
  if (request.method.toUpperCase() !== "POST") {
    return false;
  }
  try {
    const url = new URL(request.url);
    if (request.site === "chatgpt") {
      return (
        url.origin === "https://chatgpt.com" &&
        url.pathname === "/backend-api/conversation"
      );
    }
    if (request.site === "claude") {
      return (
        url.origin === "https://claude.ai" &&
        /^\/api\/organizations\/[^/]+\/chat_conversations(?:\/|$)/u.test(
          url.pathname,
        )
      );
    }
    if (request.site === "gemini") {
      const body =
        typeof request.body === "string"
          ? request.body
          : request.body instanceof URLSearchParams
            ? request.body.toString()
            : "";
      if (url.origin !== "https://gemini.google.com") return false;
      if (
        url.pathname ===
        "/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate"
      ) {
        return true;
      }
      if (url.pathname !== "/_/BardChatUi/data/batchexecute") return false;
      const rpcIds = url.searchParams.get("rpcids") ?? "";
      return !["MaZiqc", "hNvQHb", "ESY5D", "VxUbXb", "aPya6c", "PCck7e"].some(
        (rpcId) => rpcIds.includes(rpcId) || body.includes(rpcId),
      );
    }
    if (request.site === "grok") {
      return (
        url.origin === "https://grok.com" &&
        url.pathname.startsWith("/rest/app-chat/conversations/") &&
        !url.pathname.endsWith("/load-responses")
      );
    }
    return false;
  } catch {
    return false;
  }
}

export function shouldObserveWebSocket(
  site: SiteId,
  urlValue: string,
): boolean {
  if (!siteUsesWebSocketObserver(site)) return false;
  try {
    const url = new URL(urlValue);
    const hostname = site === "chatgpt" ? "chatgpt.com" : "grok.com";
    return (
      url.protocol === "wss:" &&
      (url.hostname === hostname || url.hostname.endsWith(`.${hostname}`))
    );
  } catch {
    return false;
  }
}

export function siteUsesWebSocketObserver(site: SiteId): boolean {
  return site === "chatgpt" || site === "grok";
}
