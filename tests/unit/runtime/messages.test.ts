import { describe, expect, it } from "vitest";

import {
  isRuntimeRequest,
  isTrustedObserverSender,
} from "../../../src/runtime/messages";

describe("runtime message validation", () => {
  it("accepts only a bounded Drive connection request", () => {
    expect(isRuntimeRequest({ type: "CONNECT_DRIVE" })).toBe(true);
    expect(
      isRuntimeRequest({ type: "CONNECT_DRIVE", rootFolderId: "root-a" }),
    ).toBe(true);
    expect(isRuntimeRequest({ type: "CONNECT_DRIVE", rootFolderId: 42 })).toBe(
      false,
    );
    expect(
      isRuntimeRequest({
        type: "CONNECT_DRIVE",
        rootFolderId: "root-a",
        token: "must not enter the runtime",
      }),
    ).toBe(false);
  });

  it("accepts only an exact observed-completion message", () => {
    expect(
      isRuntimeRequest({
        type: "OBSERVED_CONVERSATION_COMPLETE",
        site: "grok",
      }),
    ).toBe(true);
    expect(
      isRuntimeRequest({
        type: "OBSERVED_CONVERSATION_COMPLETE",
        site: "unknown",
      }),
    ).toBe(false);
    expect(
      isRuntimeRequest({
        type: "OBSERVED_CONVERSATION_COMPLETE",
        site: "grok",
        body: "must not enter the runtime",
      }),
    ).toBe(false);
  });

  it("validates a bounded observed stream capture against its site", () => {
    const capture = {
      conversationId: "grok-1",
      userText: "question",
      assistantText: "answer",
      observedAt: "2026-07-20T01:02:03.000Z",
      sourceUrl: "https://grok.com/c/grok-1",
    };
    expect(
      isRuntimeRequest({
        type: "OBSERVED_CONVERSATION_COMPLETE",
        site: "grok",
        capture,
      }),
    ).toBe(true);
    expect(
      isRuntimeRequest({
        type: "OBSERVED_CONVERSATION_COMPLETE",
        site: "grok",
        capture: { ...capture, sourceUrl: "https://example.com/c/grok-1" },
      }),
    ).toBe(false);
    expect(
      isRuntimeRequest({
        type: "OBSERVED_CONVERSATION_COMPLETE",
        site: "grok",
        capture: { ...capture, token: "must not enter runtime" },
      }),
    ).toBe(false);
  });

  it("requires the observer sender tab to match the requested site", () => {
    const request = {
      type: "OBSERVED_CONVERSATION_COMPLETE" as const,
      site: "grok" as const,
    };
    expect(
      isTrustedObserverSender(request, "https://grok.com/c/conversation"),
    ).toBe(true);
    expect(
      isTrustedObserverSender(request, "https://chatgpt.com/c/conversation"),
    ).toBe(false);
    expect(isTrustedObserverSender(request, undefined)).toBe(false);
  });
});
