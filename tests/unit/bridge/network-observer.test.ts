import { afterEach, describe, expect, it, vi } from "vitest";

import * as networkObserver from "../../../src/bridge/network-observer";
import {
  installFetchObserver,
  installWebSocketObserver,
  siteUsesWebSocketObserver,
  shouldObserveWebSocket,
  shouldObserveFetch,
} from "../../../src/bridge/network-observer";

afterEach(() => vi.useRealTimers());

describe("network observer request boundary", () => {
  it("observes ChatGPT generation POSTs but ignores archive reads", () => {
    expect(
      shouldObserveFetch({
        site: "chatgpt",
        url: "https://chatgpt.com/backend-api/conversation",
        method: "POST",
      }),
    ).toBe(true);
    expect(
      shouldObserveFetch({
        site: "chatgpt",
        url: "https://chatgpt.com/backend-api/f/conversation",
        method: "POST",
      }),
    ).toBe(false);
    expect(
      shouldObserveFetch({
        site: "chatgpt",
        url: "https://chatgpt.com/backend-api/conversations?offset=0",
        method: "GET",
      }),
    ).toBe(false);
    expect(
      shouldObserveFetch({
        site: "chatgpt",
        url: "https://chatgpt.com/backend-api/conversation/chat-1",
        method: "GET",
      }),
    ).toBe(false);
  });

  it("observes Claude conversation writes but rejects reads and other origins", () => {
    expect(
      shouldObserveFetch({
        site: "claude",
        url: "https://claude.ai/api/organizations/org-1/chat_conversations/chat-1/completion",
        method: "POST",
      }),
    ).toBe(true);
    expect(
      shouldObserveFetch({
        site: "claude",
        url: "https://claude.ai/api/organizations/org-1/chat_conversations/chat-1?tree=True",
        method: "GET",
      }),
    ).toBe(false);
    expect(
      shouldObserveFetch({
        site: "claude",
        url: "https://example.com/api/organizations/org-1/chat_conversations/chat-1/completion",
        method: "POST",
      }),
    ).toBe(false);
  });

  it("waits for Gemini StreamGenerate instead of the ESY5D handshake", () => {
    expect(
      shouldObserveFetch({
        site: "gemini",
        url: "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?rt=c",
        method: "POST",
      }),
    ).toBe(true);
    expect(
      shouldObserveFetch({
        site: "gemini",
        url: "https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=ESY5D",
        method: "POST",
        body: "f.req=ESY5D",
      }),
    ).toBe(false);
  });

  it("observes legacy Gemini generation RPCs but ignores archive RPCs", () => {
    const url =
      "https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=Generate";
    expect(
      shouldObserveFetch({
        site: "gemini",
        url,
        method: "POST",
        body: "f.req=GenerateConversation",
      }),
    ).toBe(true);
    for (const rpcId of ["MaZiqc", "hNvQHb"]) {
      expect(
        shouldObserveFetch({
          site: "gemini",
          url,
          method: "POST",
          body: `f.req=${rpcId}`,
        }),
      ).toBe(false);
    }
  });

  it("observes Grok conversation writes but ignores response backfill", () => {
    expect(
      shouldObserveFetch({
        site: "grok",
        url: "https://grok.com/rest/app-chat/conversations/new",
        method: "POST",
      }),
    ).toBe(true);
    expect(
      shouldObserveFetch({
        site: "grok",
        url: "https://grok.com/rest/app-chat/conversations/grok-1/load-responses",
        method: "POST",
      }),
    ).toBe(false);
  });

  it("observes ChatGPT and Grok first-party WebSockets", () => {
    expect(siteUsesWebSocketObserver("chatgpt")).toBe(true);
    expect(siteUsesWebSocketObserver("grok")).toBe(true);
    expect(siteUsesWebSocketObserver("claude")).toBe(false);
    expect(siteUsesWebSocketObserver("gemini")).toBe(false);
    expect(
      shouldObserveWebSocket(
        "chatgpt",
        "wss://ws-backend.chatgpt.com/conversation",
      ),
    ).toBe(true);
    expect(shouldObserveWebSocket("grok", "wss://grok.com/ws/app-chat")).toBe(
      true,
    );
    expect(
      shouldObserveWebSocket("grok", "wss://example.com/ws/app-chat"),
    ).toBe(false);
    expect(
      shouldObserveWebSocket("chatgpt", "wss://grok.com/ws/app-chat"),
    ).toBe(false);
  });
});

describe("fetch observer", () => {
  it("preserves the response and signals only after the cloned stream completes", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
      }),
      { status: 200 },
    );
    const originalFetch = vi.fn(async () => response);
    const target = { fetch: originalFetch as typeof globalThis.fetch };
    const signal = vi.fn();
    const installation = installFetchObserver({
      site: "chatgpt",
      target,
      signal,
    });

    const returned = await target.fetch(
      "https://chatgpt.com/backend-api/conversation",
      { method: "POST" },
    );

    expect(returned).toBe(response);
    expect(signal).not.toHaveBeenCalled();
    controller?.enqueue(new TextEncoder().encode("data: partial\n\n"));
    await Promise.resolve();
    expect(signal).not.toHaveBeenCalled();
    controller?.close();
    await vi.waitFor(() => expect(signal).toHaveBeenCalledOnce());
    expect(signal).toHaveBeenCalledWith("chatgpt");

    installation.uninstall();
    expect(target.fetch).toBe(originalFetch);
  });

  it("is idempotent when the content script runs twice", async () => {
    const originalFetch = vi.fn(
      async () => new Response("done", { status: 200 }),
    );
    const target = { fetch: originalFetch as typeof globalThis.fetch };
    const firstSignal = vi.fn();
    const secondSignal = vi.fn();
    const first = installFetchObserver({
      site: "chatgpt",
      target,
      signal: firstSignal,
    });
    const second = installFetchObserver({
      site: "chatgpt",
      target,
      signal: secondSignal,
    });

    await target.fetch("https://chatgpt.com/backend-api/conversation", {
      method: "POST",
    });
    await vi.waitFor(() => expect(firstSignal).toHaveBeenCalledOnce());

    expect(secondSignal).not.toHaveBeenCalled();
    second.uninstall();
    first.uninstall();
    expect(target.fetch).toBe(originalFetch);
  });

  it("emits a bounded Claude stream capture after preserving the response", async () => {
    const responseText = [
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: "answer" },
      })}\n\n`,
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    ].join("");
    const response = new Response(responseText, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    const originalFetch = vi.fn(async () => response);
    const target = { fetch: originalFetch as typeof globalThis.fetch };
    const signal = vi.fn();
    installFetchObserver({
      site: "claude",
      target,
      signal,
      sourceUrl: () => "https://claude.ai/chat/claude-1",
      now: () => "2026-07-20T01:02:03.000Z",
    });

    const returned = await target.fetch(
      "https://claude.ai/api/organizations/org-1/chat_conversations/claude-1/completion",
      { method: "POST", body: JSON.stringify({ prompt: "question" }) },
    );

    expect(returned).toBe(response);
    await vi.waitFor(() => expect(signal).toHaveBeenCalledOnce());
    expect(signal).toHaveBeenCalledWith("claude", {
      conversationId: "claude-1",
      userText: "question",
      assistantText: "answer",
      observedAt: "2026-07-20T01:02:03.000Z",
      sourceUrl: "https://claude.ai/chat/claude-1",
    });
  });
});

describe("XMLHttpRequest observer", () => {
  class FakeXMLHttpRequest extends EventTarget {
    method = "";
    requestBody: Document | XMLHttpRequestBodyInit | null = null;
    responseText = "done";
    status = 200;
    url = "";

    open(method: string, url: string | URL): void {
      this.method = method;
      this.url = String(url);
    }

    send(body: Document | XMLHttpRequestBodyInit | null = null): void {
      this.requestBody = body;
      this.dispatchEvent(new Event("loadend"));
    }
  }

  it("signals after Gemini completes a StreamGenerate XHR", () => {
    type InstallXmlHttpRequestObserver = (options: {
      site: "gemini";
      target: { XMLHttpRequest: typeof XMLHttpRequest };
      signal(site: "gemini"): void;
      sourceUrl(): string;
    }) => { uninstall(): void };
    const install = (
      networkObserver as typeof networkObserver & {
        installXmlHttpRequestObserver?: InstallXmlHttpRequestObserver;
      }
    ).installXmlHttpRequestObserver;
    expect(install).toBeTypeOf("function");

    const original = FakeXMLHttpRequest as unknown as typeof XMLHttpRequest;
    const target = { XMLHttpRequest: original };
    const signal = vi.fn();
    const installation = install!({
      site: "gemini",
      target,
      signal,
      sourceUrl: () => "https://gemini.google.com/app/conversation-1",
    });
    const xhr = new target.XMLHttpRequest() as unknown as FakeXMLHttpRequest;

    xhr.open(
      "POST",
      "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?rt=c",
    );
    xhr.send("f.req=payload");

    expect(xhr.requestBody).toBe("f.req=payload");
    expect(signal).toHaveBeenCalledOnce();
    expect(signal).toHaveBeenCalledWith("gemini");

    installation.uninstall();
    expect(target.XMLHttpRequest).toBe(original);
  });
});

describe("WebSocket observer", () => {
  class FakeWebSocket extends EventTarget {
    readonly url: string;

    constructor(url: string | URL) {
      super();
      this.url = String(url);
    }
  }

  it("signals immediately on ChatGPT turn completion and ignores unrelated pushes", async () => {
    vi.useFakeTimers();
    const original = FakeWebSocket as unknown as typeof WebSocket;
    const target = { WebSocket: original };
    const signal = vi.fn();
    const installation = installWebSocketObserver({
      site: "chatgpt",
      target,
      signal,
      idleMs: 1_000,
    });
    const socket = new target.WebSocket(
      "wss://ws-backend.chatgpt.com/conversation",
    );

    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify([
          { type: "message", payload: { type: "presence" } },
        ]),
      }),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(signal).not.toHaveBeenCalled();

    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify([
          {
            type: "message",
            payload: {
              type: "conversation-turn-stream",
              payload: { type: "delta", encoded_item: "sensitive" },
            },
          },
        ]),
      }),
    );
    await vi.advanceTimersByTimeAsync(999);
    expect(signal).not.toHaveBeenCalled();
    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify([
          {
            type: "message",
            payload: {
              type: "conversation-turn-complete",
              payload: { conversation_id: "conversation-1" },
            },
          },
        ]),
      }),
    );
    expect(signal).toHaveBeenCalledOnce();
    expect(signal).toHaveBeenCalledWith("chatgpt");

    installation.uninstall();
  });

  it("emits a reconstructed ChatGPT capture with the completion signal", () => {
    const original = FakeWebSocket as unknown as typeof WebSocket;
    const target = { WebSocket: original };
    const signal = vi.fn();
    installWebSocketObserver({
      site: "chatgpt",
      target,
      signal,
      sourceUrl: () => "https://chatgpt.com/c/chat-1",
      now: () => "2026-07-20T01:02:03.000Z",
    });
    const socket = new target.WebSocket(
      "wss://ws-backend.chatgpt.com/conversation",
    );
    const frame = (type: string, payload: Record<string, unknown>) =>
      JSON.stringify([
        {
          topic_id: "topic-1",
          payload: { type, payload },
        },
      ]);
    socket.dispatchEvent(
      new MessageEvent("message", {
        data: frame("conversation-turn-stream", {
          encoded_item: `data: ${JSON.stringify({
            type: "input_message",
            conversation_id: "chat-1",
            input_message: { content: { parts: ["question"] } },
          })}\n\n`,
        }),
      }),
    );
    socket.dispatchEvent(
      new MessageEvent("message", {
        data: frame("conversation-turn-stream", {
          encoded_item: `event: delta\ndata: ${JSON.stringify({
            c: 0,
            v: {
              message: {
                author: { role: "assistant" },
                channel: "final",
                content: { content_type: "text", parts: ["answer"] },
              },
            },
          })}\n\n`,
        }),
      }),
    );
    socket.dispatchEvent(
      new MessageEvent("message", {
        data: frame("conversation-turn-complete", {
          conversation_id: "chat-1",
        }),
      }),
    );

    expect(signal).toHaveBeenCalledWith("chatgpt", {
      conversationId: "chat-1",
      userText: "question",
      assistantText: "answer",
      observedAt: "2026-07-20T01:02:03.000Z",
      sourceUrl: "https://chatgpt.com/c/chat-1",
    });
  });

  it("uses Grok response.persisted and retains an idle fallback", async () => {
    vi.useFakeTimers();
    const original = FakeWebSocket as unknown as typeof WebSocket;
    const target = { WebSocket: original };
    const signal = vi.fn();
    const installation = installWebSocketObserver({
      site: "grok",
      target,
      signal,
      idleMs: 1_000,
    });
    const socket = new target.WebSocket("wss://grok.com/ws/app-chat");

    socket.dispatchEvent(new MessageEvent("message", { data: "legacy chunk" }));
    await vi.advanceTimersByTimeAsync(999);
    expect(signal).not.toHaveBeenCalled();
    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          session_id: "session-1",
          event: { type: "response.chunk", chunk: { text: "sensitive" } },
        }),
      }),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(signal).toHaveBeenCalledOnce();
    expect(signal).toHaveBeenCalledWith("grok");

    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          session_id: "session-1",
          event: { type: "response.persisted", response_id: "response-1" },
        }),
      }),
    );
    expect(signal).toHaveBeenCalledTimes(2);
    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          session_id: "session-1",
          event: {
            type: "response.chunk",
            chunk: { follow_up_suggestions: ["private suggestion"] },
          },
        }),
      }),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(signal).toHaveBeenCalledTimes(2);
    socket.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({
          session_id: "session-1",
          event: {
            type: "response.created",
            response: { status: "in_progress" },
          },
        }),
      }),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(signal).toHaveBeenCalledTimes(3);

    installation.uninstall();
    expect(target.WebSocket).toBe(original);
  });

  it("is idempotent when the WebSocket content script runs twice", () => {
    const original = FakeWebSocket as unknown as typeof WebSocket;
    const target = { WebSocket: original };
    const first = installWebSocketObserver({
      site: "grok",
      target,
      signal: vi.fn(),
    });
    const wrapped = target.WebSocket;
    const second = installWebSocketObserver({
      site: "grok",
      target,
      signal: vi.fn(),
    });

    expect(target.WebSocket).toBe(wrapped);
    second.uninstall();
    expect(target.WebSocket).toBe(wrapped);
    first.uninstall();
    expect(target.WebSocket).toBe(original);
  });
});
