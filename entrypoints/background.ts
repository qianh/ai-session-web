import { BrainCaptureRuntime, runtimeErrorCode } from "../src/runtime/app";
import {
  isRuntimeRequest,
  isTrustedObserverSender,
  type RuntimeResponse,
} from "../src/runtime/messages";

interface BackgroundApi {
  runtime: {
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

const SYNC_ALARM = "brain-capture-sync";

export default defineBackground(() => {
  const api = (globalThis as unknown as { chrome: BackgroundApi }).chrome;
  const runtime = new BrainCaptureRuntime();
  const ensureAlarm = () =>
    api.alarms.create(SYNC_ALARM, { periodInMinutes: 30 });
  const initialize = async () => {
    await runtime.recoverInterruptedSyncs();
    await ensureAlarm();
    await runtime.updateBadge();
    await runtime.reconcileObservers();
  };

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isRuntimeRequest(message)) return undefined;
    if (
      message.type === "OBSERVED_CONVERSATION_COMPLETE" &&
      !isTrustedObserverSender(message, sender.tab?.url)
    ) {
      return undefined;
    }
    void runtime
      .handle(message)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          errorCode: runtimeErrorCode(error),
        }),
      );
    return true;
  });
  api.runtime.onInstalled.addListener(() => {
    void initialize();
  });
  api.runtime.onStartup.addListener(() => {
    void initialize();
  });
  api.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM)
      void runtime.syncAll().catch(() => undefined);
  });
  void initialize();
});
