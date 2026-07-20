const BYTE_CHUNK_SIZE = 48 * 1024;

export type EncodedByteChunks = string[];

export function encodeByteChunks(bytes: Uint8Array): EncodedByteChunks {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += BYTE_CHUNK_SIZE) {
    const end = Math.min(offset + BYTE_CHUNK_SIZE, bytes.byteLength);
    let binary = "";
    for (let index = offset; index < end; index += 1) {
      binary += String.fromCharCode(bytes[index] ?? 0);
    }
    chunks.push(btoa(binary));
  }
  return chunks;
}

export function decodeByteChunks(value: unknown): Uint8Array<ArrayBuffer> {
  if (
    !Array.isArray(value) ||
    value.some((chunk) => typeof chunk !== "string")
  ) {
    throw new Error("Encoded bytes are invalid");
  }
  const decoded = value.map((chunk) => atob(chunk as string));
  const bytes = new Uint8Array(
    decoded.reduce((size, chunk) => size + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of decoded) {
    for (let index = 0; index < chunk.length; index += 1) {
      bytes[offset + index] = chunk.charCodeAt(index);
    }
    offset += chunk.length;
  }
  return bytes;
}

export function isEncodedByteChunks(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((chunk) => typeof chunk === "string")
  );
}
