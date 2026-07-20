import {
  decodeByteChunks,
  encodeByteChunks,
  isEncodedByteChunks,
} from "../../src/media/offscreen-message";

interface ConvertMessage {
  target: "brain-capture-offscreen";
  type: "CONVERT_WEBP";
  bytes: string[];
  mimeType?: string;
}

interface RuntimeApi {
  onMessage: {
    addListener(
      listener: (
        message: unknown,
        sender: unknown,
        sendResponse: (response: unknown) => void,
      ) => boolean | undefined,
    ): void;
  };
}

const runtime = (globalThis as unknown as { chrome: { runtime: RuntimeApi } })
  .chrome.runtime;

runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isConvertMessage(message)) return undefined;
  void convert(message)
    .then((bytes) => sendResponse({ ok: true, bytes: encodeByteChunks(bytes) }))
    .catch(() =>
      sendResponse({ ok: false, errorCode: "IMAGE_CONVERSION_FAILED" }),
    );
  return true;
});

async function convert(message: ConvertMessage): Promise<Uint8Array> {
  const source = new Blob([decodeByteChunks(message.bytes)], {
    type: message.mimeType ?? "application/octet-stream",
  });
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas context is unavailable");
    context.drawImage(bitmap, 0, 0);
    return new Uint8Array(
      await (
        await canvas.convertToBlob({ type: "image/webp", quality: 0.9 })
      ).arrayBuffer(),
    );
  } finally {
    bitmap.close();
  }
}

function isConvertMessage(value: unknown): value is ConvertMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Partial<ConvertMessage>;
  return (
    message.target === "brain-capture-offscreen" &&
    message.type === "CONVERT_WEBP" &&
    isEncodedByteChunks(message.bytes)
  );
}
