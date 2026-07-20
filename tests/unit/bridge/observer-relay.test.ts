import { describe, expect, it, vi } from "vitest";

import { createObserverRelay } from "../../../src/bridge/observer-relay";
import { createObserverMessage } from "../../../src/bridge/observer-message";

describe("observer relay", () => {
  it("rate limits exact page signals into fixed runtime messages", () => {
    const source = {};
    let now = 10_000;
    const send = vi.fn();
    const relay = createObserverRelay({
      source,
      origin: "https://chatgpt.com",
      send,
      now: () => now,
      minimumIntervalMs: 2_500,
    });
    const event = {
      source,
      origin: "https://chatgpt.com",
      data: createObserverMessage("chatgpt"),
    };

    expect(relay(event)).toBe(true);
    expect(relay(event)).toBe(false);
    expect(
      relay({ ...event, data: { ...event.data, url: "https://evil.example" } }),
    ).toBe(false);
    now += 2_500;
    expect(relay(event)).toBe(true);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, {
      type: "OBSERVED_CONVERSATION_COMPLETE",
      site: "chatgpt",
    });
  });

  it("relays a validated stream capture without adding page data", () => {
    const source = {};
    const capture = {
      conversationId: "claude-1",
      userText: "question",
      assistantText: "answer",
      observedAt: "2026-07-20T01:02:03.000Z",
      sourceUrl: "https://claude.ai/chat/claude-1",
    };
    const send = vi.fn(async () => {
      throw new Error("runtime unavailable");
    });
    const relay = createObserverRelay({
      source,
      origin: "https://claude.ai",
      send,
    });

    expect(
      relay({
        source,
        origin: "https://claude.ai",
        data: createObserverMessage("claude", capture),
      }),
    ).toBe(true);
    expect(send).toHaveBeenCalledWith({
      type: "OBSERVED_CONVERSATION_COMPLETE",
      site: "claude",
      capture,
    });
  });
});
