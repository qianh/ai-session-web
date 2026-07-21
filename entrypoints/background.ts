import { BrainCaptureRuntime, runtimeErrorCode } from "../src/runtime/app";
import {
  isRuntimeRequest,
  isTrustedObserverSender,
  type RuntimeRequest,
  type RuntimeResponse,
} from "../src/runtime/messages";

interface BackgroundApi {
  runtime: {
    getPlatformInfo(): Promise<unknown>;
    onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: { tab?: { url?: string } },
          sendResponse: (response: RuntimeResponse) => void,
        ) => boolean | undefined,
      ): void;
    };
    onInstalled: { addListener(listener: () => void): void };
    onStartup: { addListener(listener: () => void): void };
  };
  alarms: {
    create(name: string, info: { periodInMinutes: number }): Promise<void>;
    onAlarm: { addListener(listener: (alarm: { name: string }) => void): void };
  };
}

interface BackgroundMessageListenerOptions {
  handle(request: RuntimeRequest): Promise<unknown>;
  runTask(task: () => Promise<unknown>): Promise<unknown>;
}

const SYNC_ALARM = "brain-capture-sync";
const KEEPALIVE_INTERVAL_MS = 20_000;

export class ServiceWorkerKeepalive {
  #activeTasks = 0;
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly api: { getPlatformInfo(): Promise<unknown> }) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    this.#activeTasks += 1;
    if (this.#activeTasks === 1) this.#start();
    try {
      return await task();
    } finally {
      this.#activeTasks -= 1;
      if (this.#activeTasks === 0) this.#stop();
    }
  }

  #start(): void {
    const pulse = () => {
      void this.api.getPlatformInfo().catch(() => undefined);
    };
    pulse();
    this.#timer = setInterval(pulse, KEEPALIVE_INTERVAL_MS);
  }

  #stop(): void {
    if (this.#timer === undefined) return;
    clearInterval(this.#timer);
    this.#timer = undefined;
  }
}

export function createBackgroundMessageListener({
  handle,
  runTask,
}: BackgroundMessageListenerOptions) {
  return (
    message: unknown,
    sender: { tab?: { url?: string } },
    sendResponse: (response: RuntimeResponse) => void,
  ): boolean | undefined => {
    if (!isRuntimeRequest(message)) return undefined;
    if (
      message.type === "OBSERVED_CONVERSATION_COMPLETE" &&
      !isTrustedObserverSender(message, sender.tab?.url)
    ) {
      return undefined;
    }
    if (message.type === "OBSERVED_CONVERSATION_COMPLETE") {
      void runTask(() => handle(message)).catch(() => undefined);
      sendResponse({ ok: true });
      return undefined;
    }
    const task =
      message.type === "SYNC_SITE" || message.type === "SYNC_ALL"
        ? runTask(() => handle(message))
        : handle(message);
    void task
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          errorCode: runtimeErrorCode(error),
        }),
      );
    return true;
  };
}

export default defineBackground(() => {
  const api = (globalThis as unknown as { chrome: BackgroundApi }).chrome;
  const runtime = new BrainCaptureRuntime();
  const keepalive = new ServiceWorkerKeepalive(api.runtime);
  const ensureAlarm = () =>
    api.alarms.create(SYNC_ALARM, { periodInMinutes: 30 });
  const initialize = async () => {
    await runtime.recoverInterruptedSyncs();
    await ensureAlarm();
    await runtime.updateBadge();
    await runtime.reconcileObservers();
  };

  api.runtime.onMessage.addListener(
    createBackgroundMessageListener({
      handle: (message) => runtime.handle(message),
      runTask: (task) => keepalive.run(task),
    }),
  );
  api.runtime.onInstalled.addListener(() => {
    void initialize();
  });
  api.runtime.onStartup.addListener(() => {
    void initialize();
  });
  api.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM)
      void keepalive.run(() => runtime.syncAll()).catch(() => undefined);
  });
  void initialize();
});
