import { describe, expect, it, vi } from "vitest";

import { SiteTaskCoordinator } from "../../../src/sync/site-task-coordinator";

describe("SiteTaskCoordinator", () => {
  it("coalesces same-site work and serializes different sites", async () => {
    let releaseGrok: (() => void) | undefined;
    const grokTask = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          releaseGrok = () => resolve("grok-done");
        }),
    );
    const chatGptTask = vi.fn(async () => "chatgpt-done");
    const coordinator = new SiteTaskCoordinator();

    const first = coordinator.run("grok", grokTask);
    const second = coordinator.run("grok", grokTask);
    const otherSite = coordinator.run("chatgpt", chatGptTask);

    expect(first).toBe(second);
    await Promise.resolve();
    expect(grokTask).toHaveBeenCalledOnce();
    expect(chatGptTask).not.toHaveBeenCalled();
    releaseGrok?.();
    await expect(first).resolves.toBe("grok-done");
    await expect(otherSite).resolves.toBe("chatgpt-done");
    expect(chatGptTask).toHaveBeenCalledOnce();
  });
});
