export interface StreamTurnCapture {
  conversationId: string;
  userText: string;
  assistantText: string;
  observedAt: string;
  sourceUrl: string;
}

interface ChatGptStreamAccumulatorOptions {
  sourceUrl: string | (() => string);
  now?: () => string;
  maxBytes?: number;
  maxTextChars?: number;
}

interface GrokStreamAccumulatorOptions {
  sourceUrl: string | (() => string);
  now?: () => string;
  maxBytes?: number;
  maxTextChars?: number;
}

interface DeltaOperation {
  p?: unknown;
  o?: unknown;
  v?: unknown;
  c?: unknown;
}

interface ChatGptTopicState {
  bytes: number;
  overflowed: boolean;
  conversationId?: string;
  userText?: string;
  contexts: Map<number, unknown>;
  activeContext?: number;
  inheritedOperation?: { p?: unknown; o?: unknown };
}

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_MAX_TEXT_CHARS = 512 * 1024;

interface FetchStreamCaptureInput {
  requestUrl: string;
  requestBody: string;
  responseText: string;
  sourceUrl: string;
  observedAt: string;
  maxBytes?: number;
  maxTextChars?: number;
}

export function parseClaudeStreamCapture(
  input: FetchStreamCaptureInput,
): StreamTurnCapture | undefined {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxTextChars = input.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
  if (
    utf8Length(input.requestBody) + utf8Length(input.responseText) >
    maxBytes
  ) {
    return undefined;
  }
  let requestUrl: URL;
  let sourceUrl: URL;
  try {
    requestUrl = new URL(input.requestUrl);
    sourceUrl = new URL(input.sourceUrl);
  } catch {
    return undefined;
  }
  const match = requestUrl.pathname.match(
    /^\/api\/organizations\/[^/]+\/chat_conversations\/([^/]+)\/completion$/u,
  );
  if (
    requestUrl.origin !== "https://claude.ai" ||
    sourceUrl.origin !== requestUrl.origin ||
    !match?.[1]
  ) {
    return undefined;
  }
  let body: unknown;
  try {
    body = JSON.parse(input.requestBody);
  } catch {
    return undefined;
  }
  const userText = isRecord(body) ? readString(body.prompt)?.trim() : undefined;
  const assistantParts: string[] = [];
  for (const line of input.responseText.split("\n")) {
    if (!line.startsWith("data:")) continue;
    let event: unknown;
    try {
      event = JSON.parse(line.slice(5).trim());
    } catch {
      continue;
    }
    if (
      isRecord(event) &&
      event.type === "content_block_delta" &&
      isRecord(event.delta) &&
      event.delta.type === "text_delta" &&
      typeof event.delta.text === "string"
    ) {
      assistantParts.push(event.delta.text);
    }
  }
  const assistantText = assistantParts.join("").trim();
  const conversationId = decodeURIComponent(match[1]);
  if (
    !userText ||
    !assistantText ||
    conversationId.length > 256 ||
    userText.length > maxTextChars ||
    assistantText.length > maxTextChars ||
    Number.isNaN(Date.parse(input.observedAt))
  ) {
    return undefined;
  }
  return {
    conversationId,
    userText,
    assistantText,
    observedAt: input.observedAt,
    sourceUrl: sourceUrl.href,
  };
}

export function parseGeminiStreamCapture(
  input: FetchStreamCaptureInput,
): StreamTurnCapture | undefined {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxTextChars = input.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
  if (
    utf8Length(input.requestBody) + utf8Length(input.responseText) >
    maxBytes
  ) {
    return undefined;
  }
  let requestUrl: URL;
  let sourceUrl: URL;
  try {
    requestUrl = new URL(input.requestUrl);
    sourceUrl = new URL(input.sourceUrl);
  } catch {
    return undefined;
  }
  if (
    requestUrl.origin !== "https://gemini.google.com" ||
    sourceUrl.origin !== requestUrl.origin ||
    requestUrl.pathname !==
      "/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate"
  ) {
    return undefined;
  }
  let requestEnvelope: unknown;
  try {
    requestEnvelope = JSON.parse(
      new URLSearchParams(input.requestBody).get("f.req") ?? "",
    );
  } catch {
    return undefined;
  }
  let requestPayload: unknown;
  try {
    requestPayload =
      Array.isArray(requestEnvelope) && typeof requestEnvelope[1] === "string"
        ? JSON.parse(requestEnvelope[1])
        : undefined;
  } catch {
    return undefined;
  }
  const userText =
    Array.isArray(requestPayload) &&
    Array.isArray(requestPayload[0]) &&
    typeof requestPayload[0][0] === "string"
      ? requestPayload[0][0].trim()
      : undefined;
  let finalPayload: unknown[] | undefined;
  for (const line of input.responseText.split("\n")) {
    const candidate = line.trim();
    if (!candidate.startsWith("[")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    for (const tuple of findRpcTuples(parsed)) {
      if (typeof tuple[2] !== "string") continue;
      try {
        const payload = JSON.parse(tuple[2]);
        if (Array.isArray(payload)) finalPayload = payload;
      } catch {
        // Ignore incomplete batchexecute frames.
      }
    }
  }
  const assistantText =
    Array.isArray(finalPayload?.[4]) &&
    Array.isArray(finalPayload[4][0]) &&
    Array.isArray(finalPayload[4][0][1]) &&
    typeof finalPayload[4][0][1][0] === "string"
      ? finalPayload[4][0][1][0].trim()
      : undefined;
  const conversationId = readString(finalPayload?.[39])?.trim();
  if (
    !conversationId ||
    conversationId.length > 256 ||
    !userText ||
    !assistantText ||
    userText.length > maxTextChars ||
    assistantText.length > maxTextChars ||
    Number.isNaN(Date.parse(input.observedAt))
  ) {
    return undefined;
  }
  return {
    conversationId,
    userText,
    assistantText,
    observedAt: input.observedAt,
    sourceUrl: sourceUrl.href,
  };
}

function findRpcTuples(value: unknown): unknown[][] {
  if (!Array.isArray(value)) return [];
  const found: unknown[][] = value[0] === "wrb.fr" ? [value] : [];
  for (const child of value) found.push(...findRpcTuples(child));
  return found;
}

export class GrokStreamAccumulator {
  readonly #sourceUrl: string | (() => string);
  readonly #now: () => string;
  readonly #maxBytes: number;
  readonly #maxTextChars: number;
  #bytes = 0;
  #overflowed = false;
  #userText: string | undefined;
  #assistantParts: string[] = [];

  constructor(options: GrokStreamAccumulatorOptions) {
    this.#sourceUrl = options.sourceUrl;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.#maxTextChars = options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
  }

  push(rawFrame: string): StreamTurnCapture | undefined {
    let root: unknown;
    try {
      root = JSON.parse(rawFrame);
    } catch {
      return undefined;
    }
    if (!isRecord(root) || !isRecord(root.event)) return undefined;
    const event = root.event;
    if (event.type === "conversation.item.added" && isRecord(event.item)) {
      const item = event.item;
      if (item.role !== "user") return undefined;
      this.#reset();
      this.#bytes = utf8Length(rawFrame);
      this.#userText = readGrokUserText(item);
      return undefined;
    }
    if (!this.#userText) return undefined;
    this.#bytes += utf8Length(rawFrame);
    if (this.#bytes > this.#maxBytes) this.#overflowed = true;
    if (event.type === "response.created") {
      this.#assistantParts = [];
      return undefined;
    }
    if (
      event.type === "response.chunk" &&
      isRecord(event.chunk) &&
      isRecord(event.chunk.text) &&
      event.chunk.text.channel === "CHANNEL_ASSISTANT_RESPONSE" &&
      typeof event.chunk.text.text === "string"
    ) {
      this.#assistantParts.push(event.chunk.text.text);
      return undefined;
    }
    if (event.type !== "response.persisted") return undefined;
    const capture = this.#capture();
    this.#reset();
    return capture;
  }

  #capture(): StreamTurnCapture | undefined {
    let sourceUrl: URL;
    try {
      sourceUrl = new URL(resolveSourceUrl(this.#sourceUrl));
    } catch {
      return undefined;
    }
    const match = sourceUrl.pathname.match(/^\/c\/([^/]+)$/u);
    const userText = this.#userText?.trim();
    const assistantText = this.#assistantParts.join("").trim();
    const conversationId = match?.[1]
      ? decodeURIComponent(match[1])
      : undefined;
    if (
      this.#overflowed ||
      !conversationId ||
      conversationId.length > 256 ||
      !userText ||
      !assistantText ||
      userText.length > this.#maxTextChars ||
      assistantText.length > this.#maxTextChars
    ) {
      return undefined;
    }
    return {
      conversationId,
      userText,
      assistantText,
      observedAt: this.#now(),
      sourceUrl: sourceUrl.href,
    };
  }

  #reset(): void {
    this.#bytes = 0;
    this.#overflowed = false;
    this.#userText = undefined;
    this.#assistantParts = [];
  }
}

function readGrokUserText(item: Record<string, unknown>): string | undefined {
  if (!isRecord(item.x_grok) || !Array.isArray(item.x_grok.input_chunks)) {
    return undefined;
  }
  const parts = item.x_grok.input_chunks.flatMap((candidate) => {
    if (
      !isRecord(candidate) ||
      !isRecord(candidate.text) ||
      typeof candidate.text.text !== "string"
    ) {
      return [];
    }
    return [candidate.text.text];
  });
  const text = parts.join("\n\n").trim();
  return text || undefined;
}

export class ChatGptStreamAccumulator {
  readonly #topics = new Map<string, ChatGptTopicState>();
  readonly #sourceUrl: string | (() => string);
  readonly #now: () => string;
  readonly #maxBytes: number;
  readonly #maxTextChars: number;

  constructor(options: ChatGptStreamAccumulatorOptions) {
    this.#sourceUrl = options.sourceUrl;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.#maxTextChars = options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
  }

  push(rawFrame: string): StreamTurnCapture | undefined {
    let frame: unknown;
    try {
      frame = JSON.parse(rawFrame);
    } catch {
      return undefined;
    }
    const messages = Array.isArray(frame) ? frame : [frame];
    for (const candidate of messages) {
      if (!isRecord(candidate) || !isRecord(candidate.payload)) continue;
      const topicId = readString(candidate.topic_id);
      if (!topicId) continue;
      const type = candidate.payload.type;
      if (type === "conversation-turn-stream") {
        const state = this.#topic(topicId);
        state.bytes += utf8Length(rawFrame);
        if (state.bytes > this.#maxBytes) state.overflowed = true;
        const payload = candidate.payload.payload;
        if (isRecord(payload) && typeof payload.encoded_item === "string") {
          this.#ingestEncodedItem(state, payload.encoded_item);
        }
        continue;
      }
      if (type === "conversation-turn-complete") {
        const state = this.#topics.get(topicId);
        this.#topics.delete(topicId);
        if (!state || state.overflowed) return undefined;
        return this.#capture(state);
      }
    }
    return undefined;
  }

  #topic(topicId: string): ChatGptTopicState {
    const existing = this.#topics.get(topicId);
    if (existing) return existing;
    const created: ChatGptTopicState = {
      bytes: 0,
      overflowed: false,
      contexts: new Map(),
    };
    this.#topics.set(topicId, created);
    return created;
  }

  #ingestEncodedItem(state: ChatGptTopicState, encodedItem: string): void {
    if (state.overflowed) return;
    const event = encodedItem
      .split("\n")
      .find((line) => line.startsWith("event:"))
      ?.slice(6)
      .trim();
    for (const line of encodedItem.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      if (isRecord(parsed) && parsed.type === "input_message") {
        const conversationId = readString(parsed.conversation_id);
        const userText = readContentParts(parsed.input_message);
        if (conversationId) state.conversationId = conversationId;
        else delete state.conversationId;
        if (userText) state.userText = userText;
        else delete state.userText;
      } else if (event === "delta" && isRecord(parsed)) {
        ingestChatGptDelta(state, parsed);
      }
    }
  }

  #capture(state: ChatGptTopicState): StreamTurnCapture | undefined {
    let sourceUrl: URL;
    try {
      sourceUrl = new URL(resolveSourceUrl(this.#sourceUrl));
    } catch {
      return undefined;
    }
    const conversationId = state.conversationId?.trim();
    const userText = state.userText?.trim();
    let assistantText: string | undefined;
    for (const value of state.contexts.values()) {
      if (!isRecord(value) || !isRecord(value.message)) continue;
      const message = value.message;
      const author = isRecord(message.author) ? message.author : undefined;
      const content = isRecord(message.content) ? message.content : undefined;
      if (
        author?.role !== "assistant" ||
        message.channel !== "final" ||
        content?.content_type !== "text"
      ) {
        continue;
      }
      assistantText = readContentParts(content)?.trim();
    }
    if (
      !conversationId ||
      conversationId.length > 256 ||
      sourceUrl.origin !== "https://chatgpt.com" ||
      !userText ||
      !assistantText ||
      userText.length > this.#maxTextChars ||
      assistantText.length > this.#maxTextChars
    ) {
      return undefined;
    }
    return {
      conversationId,
      userText,
      assistantText,
      observedAt: this.#now(),
      sourceUrl: sourceUrl.href,
    };
  }
}

function ingestChatGptDelta(
  state: ChatGptTopicState,
  delta: DeltaOperation,
): void {
  if (typeof delta.c === "number" && Number.isInteger(delta.c)) {
    state.activeContext = delta.c;
    state.contexts.set(
      delta.c,
      typeof delta.o === "string"
        ? applyDeltaOperation(state.contexts.get(delta.c), delta)
        : cloneValue(delta.v),
    );
    delete state.inheritedOperation;
    return;
  }
  if (state.activeContext === undefined) return;
  let root = state.contexts.get(state.activeContext);
  if (delta.o === "patch" && Array.isArray(delta.v)) {
    for (const candidate of delta.v.slice(0, 100)) {
      if (!isRecord(candidate)) continue;
      root = applyDeltaOperation(root, candidate);
      state.inheritedOperation = { p: candidate.p, o: candidate.o };
    }
  } else if (typeof delta.o === "string") {
    root = applyDeltaOperation(root, delta);
    state.inheritedOperation = { p: delta.p, o: delta.o };
  } else if (Object.hasOwn(delta, "v") && state.inheritedOperation) {
    root = applyDeltaOperation(root, {
      ...state.inheritedOperation,
      v: delta.v,
    });
  }
  state.contexts.set(state.activeContext, root);
}

function applyDeltaOperation(
  root: unknown,
  operation: DeltaOperation,
): unknown {
  const op = operation.o;
  const path = typeof operation.p === "string" ? operation.p : "";
  if (op === "patch" && Array.isArray(operation.v)) {
    let next = root;
    for (const child of operation.v.slice(0, 100)) {
      if (isRecord(child)) next = applyDeltaOperation(next, child);
    }
    return next;
  }
  if (!["add", "replace", "append"].includes(String(op))) return root;
  const segments = decodePointer(path);
  if (!segments) return root;
  if (segments.length === 0) {
    return op === "append"
      ? `${typeof root === "string" ? root : ""}${String(operation.v ?? "")}`
      : cloneValue(operation.v);
  }
  if (!isRecord(root) && !Array.isArray(root)) return root;
  let parent: Record<string, unknown> | unknown[] = root;
  for (const segment of segments.slice(0, -1)) {
    const child = parent[segment as keyof typeof parent];
    if (!isRecord(child) && !Array.isArray(child)) return root;
    parent = child;
  }
  const leaf = segments.at(-1);
  if (!leaf) return root;
  if (op === "append") {
    const current = parent[leaf as keyof typeof parent];
    parent[leaf as keyof typeof parent] =
      `${typeof current === "string" ? current : ""}${String(operation.v ?? "")}` as never;
  } else {
    parent[leaf as keyof typeof parent] = cloneValue(operation.v) as never;
  }
  return root;
}

function decodePointer(path: string): string[] | undefined {
  if (path === "") return [];
  if (!path.startsWith("/")) return undefined;
  const segments = path
    .slice(1)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  if (
    segments.length > 32 ||
    segments.some((part) =>
      ["__proto__", "prototype", "constructor"].includes(part),
    )
  ) {
    return undefined;
  }
  return segments;
}

function readContentParts(value: unknown): string | undefined {
  const content =
    isRecord(value) && isRecord(value.content) ? value.content : value;
  if (!isRecord(content) || !Array.isArray(content.parts)) return undefined;
  const text = content.parts
    .filter((part): part is string => typeof part === "string")
    .join("\n\n")
    .trim();
  return text || undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function resolveSourceUrl(sourceUrl: string | (() => string)): string {
  return typeof sourceUrl === "function" ? sourceUrl() : sourceUrl;
}
