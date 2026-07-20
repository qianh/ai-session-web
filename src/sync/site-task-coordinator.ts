import type { SiteId } from "../state/store";

export class SiteTaskCoordinator {
  readonly #running = new Map<SiteId, Promise<unknown>>();
  #tail: Promise<unknown> = Promise.resolve();

  run<T>(site: SiteId, task: () => Promise<T>): Promise<T> {
    const existing = this.#running.get(site);
    if (existing) return existing as Promise<T>;
    const operation = this.#tail.then(task, task);
    this.#tail = operation.catch(() => undefined);
    this.#running.set(site, operation);
    const cleanup = () => {
      if (this.#running.get(site) === operation) this.#running.delete(site);
    };
    void operation.then(cleanup, cleanup);
    return operation;
  }
}
