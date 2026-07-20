import { describe, expect, it } from "vitest";

import {
  createObserverMessage,
  parseObserverMessage,
} from "../../../src/bridge/observer-message";

describe("observer page message boundary", () => {
  it("accepts only the exact completion signal for the current site", () => {
    const source = {};
    const valid = {
      source,
      origin: "https://grok.com",
      data: createObserverMessage("grok"),
    };

    expect(parseObserverMessage(valid, source, "https://grok.com")).toEqual({
      site: "grok",
    });
    expect(
      parseObserverMessage(
        {
          ...valid,
          data: { ...valid.data, body: "must not cross worlds" },
        },
        source,
        "https://grok.com",
      ),
    ).toBeUndefined();
    expect(parseObserverMessage(valid, {}, "https://grok.com")).toBeUndefined();
    expect(
      parseObserverMessage(valid, source, "https://claude.ai"),
    ).toBeUndefined();
  });

  it("accepts a bounded same-origin stream capture and rejects extra fields", () => {
    const source = {};
    const capture = {
      conversationId: "grok-1",
      userText: "question",
      assistantText: "answer",
      observedAt: "2026-07-20T01:02:03.000Z",
      sourceUrl: "https://grok.com/c/grok-1",
    };
    const data = createObserverMessage("grok", capture);
    const event = { source, origin: "https://grok.com", data };

    expect(parseObserverMessage(event, source, event.origin)).toEqual({
      site: "grok",
      capture,
    });
    expect(
      parseObserverMessage(
        {
          ...event,
          data: {
            ...data,
            capture: { ...capture, cookie: "must not cross worlds" },
          },
        },
        source,
        event.origin,
      ),
    ).toBeUndefined();
    expect(
      parseObserverMessage(
        {
          ...event,
          data: {
            ...data,
            capture: {
              ...capture,
              sourceUrl: "https://example.com/c/grok-1",
            },
          },
        },
        source,
        event.origin,
      ),
    ).toBeUndefined();
  });
});
