import { decodeByteChunks, encodeByteChunks } from "./offscreen-message";

interface OffscreenApi {
  hasDocument(): Promise<boolean>;
  createDocument(options: {
    url: string;
    reasons: ["BLOBS"];
    justification: string;
  }): Promise<void>;
}

interface RuntimeApi {
  getURL(path: string): string;
  sendMessage(message: {
    target: "brain-capture-offscreen";
    type: "CONVERT_WEBP";
    bytes: string[];
    mimeType?: string;
  }): Promise<{ ok: boolean; bytes?: string[]; errorCode?: string }>;
}

interface OffscreenChromeApi {
  offscreen: OffscreenApi;
  runtime: RuntimeApi;
}

export class OffscreenImageConverter {
  #ready: Promise<void> | undefined;

  constructor(
    private readonly api: OffscreenChromeApi = (
      globalThis as unknown as { chrome: OffscreenChromeApi }
    ).chrome,
  ) {}

  async convert(bytes: Uint8Array, mimeType?: string): Promise<Uint8Array> {
    await this.#ensureDocument();
    const response = await this.api.runtime.sendMessage({
      target: "brain-capture-offscreen",
      type: "CONVERT_WEBP",
      bytes: encodeByteChunks(bytes),
      ...(mimeType ? { mimeType } : {}),
    });
    if (!response.ok || response.bytes === undefined) {
      throw new Error(response.errorCode ?? "IMAGE_CONVERSION_FAILED");
    }
    try {
      return decodeByteChunks(response.bytes);
    } catch {
      throw new Error("IMAGE_CONVERSION_FAILED");
    }
  }

  #ensureDocument(): Promise<void> {
    this.#ready ??= (async () => {
      if (await this.api.offscreen.hasDocument()) return;
      await this.api.offscreen.createDocument({
        url: this.api.runtime.getURL("offscreen.html"),
        reasons: ["BLOBS"],
        justification: "Convert archived AI images to WebP",
      });
    })().catch((error) => {
      this.#ready = undefined;
      throw error;
    });
    return this.#ready;
  }
}
