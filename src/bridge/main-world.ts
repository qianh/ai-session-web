export type PageRequest =
  | {
      kind: "chatgpt-api";
      path: string;
      method?: "GET" | "POST";
      body?: unknown;
    }
  | { kind: "claude-context" }
  | {
      kind: "media-start";
      url: string;
      cacheKey: string;
      maxBytes: number;
    }
  | { kind: "media-chunk"; cacheKey: string; offset: number; length: number }
  | { kind: "media-release"; cacheKey: string }
  | {
      kind: "site-api";
      site: "claude" | "grok";
      path: string;
      method?: "GET" | "POST";
      body?: unknown;
    }
  | { kind: "gemini-rpc"; rpcId: "MaZiqc" | "hNvQHb"; payload: unknown };

export type PageResponse =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; errorCode: string; retryAfterMs?: number };

export interface PageEnvironment {
  origin: string;
  pathname: string;
  language: string;
  fetch: typeof fetch;
  wizGlobalData: Record<string, unknown>;
  resourceUrls?: string[];
  mediaCache?: Map<string, { bytes: Uint8Array; mimeType: string }>;
}

// This function is passed directly to chrome.scripting.executeScript. Keep its
// runtime dependencies entirely inside the function body.
export async function executePageRequest(
  request: PageRequest,
  testEnvironment?: PageEnvironment,
): Promise<PageResponse> {
  const pageGlobal = globalThis as typeof globalThis & {
    WIZ_global_data?: Record<string, unknown>;
    __brainCaptureMediaCache?: Map<
      string,
      { bytes: Uint8Array; mimeType: string }
    >;
  };
  const runtime: PageEnvironment = testEnvironment ?? {
    origin: location.origin,
    pathname: location.pathname,
    language: document.documentElement.lang || navigator.language || "en",
    fetch: globalThis.fetch.bind(globalThis),
    wizGlobalData: pageGlobal.WIZ_global_data ?? {},
    resourceUrls: performance
      .getEntriesByType("resource")
      .map((entry) => entry.name),
    mediaCache: (pageGlobal.__brainCaptureMediaCache ??= new Map()),
  };

  const failure = (
    status: number,
    errorCode: string,
    retryAfterMs?: number,
  ): PageResponse => ({
    ok: false,
    status,
    errorCode,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  });
  const sameOriginPath = (path: string): URL | undefined => {
    if (!path.startsWith("/")) return undefined;
    const url = new URL(path, runtime.origin);
    return url.origin === runtime.origin ? url : undefined;
  };
  const readResponse = async (response: Response): Promise<PageResponse> => {
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      let retryAfterMs: number | undefined;
      if (retryAfter) {
        const seconds = Number(retryAfter);
        const delay = Number.isFinite(seconds)
          ? seconds * 1000
          : Date.parse(retryAfter) - Date.now();
        if (Number.isFinite(delay) && delay >= 0) {
          retryAfterMs = Math.min(delay, 60_000);
        }
      }
      return failure(
        response.status,
        `SITE_HTTP_${response.status}`,
        retryAfterMs,
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        return {
          ok: true,
          status: response.status,
          data: await response.json(),
        };
      } catch {
        return failure(response.status, "BRIDGE_INVALID_JSON");
      }
    }
    return { ok: true, status: response.status, data: await response.text() };
  };

  try {
    if (request.kind === "media-start") {
      if (!/^[A-Za-z0-9-]{16,80}$/u.test(request.cacheKey)) {
        return failure(0, "BRIDGE_CACHE_KEY_INVALID");
      }
      let url: URL;
      try {
        url = new URL(request.url);
      } catch {
        return failure(0, "BRIDGE_MEDIA_URL_INVALID");
      }
      if (
        !["https:", "http:"].includes(url.protocol) ||
        !Number.isInteger(request.maxBytes) ||
        request.maxBytes <= 0
      ) {
        return failure(0, "BRIDGE_MEDIA_URL_INVALID");
      }
      const response = await runtime.fetch(url, { credentials: "include" });
      if (!response.ok)
        return failure(response.status, "MEDIA_DOWNLOAD_FAILED");
      const declaredSize = Number(response.headers.get("content-length") ?? 0);
      if (declaredSize > request.maxBytes)
        return failure(413, "MEDIA_TOO_LARGE");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > request.maxBytes)
        return failure(413, "MEDIA_TOO_LARGE");
      const mimeType =
        response.headers.get("content-type")?.split(";", 1)[0] ??
        "application/octet-stream";
      const cache = (runtime.mediaCache ??= new Map());
      cache.set(request.cacheKey, { bytes, mimeType });
      return {
        ok: true,
        status: response.status,
        data: { size: bytes.byteLength, mimeType },
      };
    }

    if (request.kind === "media-chunk") {
      const cached = runtime.mediaCache?.get(request.cacheKey);
      if (!cached) return failure(404, "MEDIA_CACHE_MISS");
      if (
        !Number.isInteger(request.offset) ||
        !Number.isInteger(request.length) ||
        request.offset < 0 ||
        request.length <= 0 ||
        request.length > 512 * 1024
      ) {
        return failure(0, "BRIDGE_MEDIA_RANGE_INVALID");
      }
      const chunk = cached.bytes.subarray(
        request.offset,
        Math.min(cached.bytes.length, request.offset + request.length),
      );
      let binary = "";
      for (const byte of chunk) binary += String.fromCharCode(byte);
      return { ok: true, status: 200, data: btoa(binary) };
    }

    if (request.kind === "media-release") {
      runtime.mediaCache?.delete(request.cacheKey);
      return { ok: true, status: 200, data: null };
    }

    if (request.kind === "claude-context") {
      if (runtime.origin !== "https://claude.ai") {
        return failure(0, "BRIDGE_ORIGIN_MISMATCH");
      }
      const ids = new Set<string>();
      for (const resource of runtime.resourceUrls ?? []) {
        try {
          const url = new URL(resource);
          const match = url.pathname.match(
            /^\/api\/organizations\/([^/]+)\/(?:chat_conversations|projects)/u,
          );
          if (match?.[1]) ids.add(decodeURIComponent(match[1]));
        } catch {
          // Ignore malformed resource entries.
        }
      }
      return {
        ok: true,
        status: 200,
        data: { organizationIds: [...ids].sort() },
      };
    }

    if (request.kind === "chatgpt-api") {
      if (runtime.origin !== "https://chatgpt.com") {
        return failure(0, "BRIDGE_ORIGIN_MISMATCH");
      }
      const url = sameOriginPath(request.path);
      if (!url || !url.pathname.startsWith("/backend-api/conversation")) {
        return failure(0, "BRIDGE_PATH_DENIED");
      }
      const sessionResponse = await runtime.fetch(
        `${runtime.origin}/api/auth/session`,
        {
          credentials: "include",
        },
      );
      if (!sessionResponse.ok) {
        return failure(sessionResponse.status, "CHATGPT_SESSION_REQUIRED");
      }
      const session = (await sessionResponse.json()) as Record<string, unknown>;
      const accessToken =
        typeof session.accessToken === "string" ? session.accessToken : "";
      if (!accessToken) return failure(401, "CHATGPT_SESSION_REQUIRED");
      return readResponse(
        await runtime.fetch(url, {
          method: request.method ?? "GET",
          credentials: "include",
          headers: {
            authorization: `Bearer ${accessToken}`,
            ...(request.body === undefined
              ? {}
              : { "content-type": "application/json" }),
          },
          ...(request.body === undefined
            ? {}
            : { body: JSON.stringify(request.body) }),
        }),
      );
    }

    if (request.kind === "site-api") {
      const expectedOrigin =
        request.site === "claude" ? "https://claude.ai" : "https://grok.com";
      const allowedPrefix =
        request.site === "claude" ? "/api/organizations/" : "/rest/";
      const url = sameOriginPath(request.path);
      if (
        runtime.origin !== expectedOrigin ||
        !url ||
        !url.pathname.startsWith(allowedPrefix)
      ) {
        return failure(0, "BRIDGE_PATH_DENIED");
      }
      const init: RequestInit = {
        method: request.method ?? "GET",
        credentials: "include",
      };
      if (request.body !== undefined) {
        init.headers = { "content-type": "application/json" };
        init.body = JSON.stringify(request.body);
      }
      return readResponse(await runtime.fetch(url, init));
    }

    if (runtime.origin !== "https://gemini.google.com") {
      return failure(0, "BRIDGE_ORIGIN_MISMATCH");
    }
    const antiCsrf = runtime.wizGlobalData.SNlM0e;
    const buildLabel = runtime.wizGlobalData.cfb2h;
    const sessionId = runtime.wizGlobalData.FdrFJe;
    if (
      typeof antiCsrf !== "string" ||
      typeof buildLabel !== "string" ||
      typeof sessionId !== "string"
    ) {
      return failure(401, "GEMINI_SESSION_REQUIRED");
    }
    const rpcUrl = new URL("/_/BardChatUi/data/batchexecute", runtime.origin);
    rpcUrl.searchParams.set("rpcids", request.rpcId);
    rpcUrl.searchParams.set(
      "source-path",
      runtime.pathname.startsWith("/app") ? "/app" : runtime.pathname,
    );
    rpcUrl.searchParams.set("bl", buildLabel);
    rpcUrl.searchParams.set("f.sid", sessionId);
    rpcUrl.searchParams.set("hl", runtime.language);
    rpcUrl.searchParams.set("_reqid", String(Date.now() % 1_000_000_000));
    rpcUrl.searchParams.set("rt", "c");
    const form = new URLSearchParams({
      at: antiCsrf,
      "f.req": JSON.stringify([
        [[request.rpcId, JSON.stringify(request.payload), null, "generic"]],
      ]),
    });
    const response = await runtime.fetch(rpcUrl, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "x-same-domain": "1",
      },
      body: form.toString(),
    });
    if (!response.ok) return readResponse(response);
    return { ok: true, status: response.status, data: await response.text() };
  } catch {
    return failure(0, "BRIDGE_REQUEST_FAILED");
  }
}
