const COMPRESSED_PREFIX = 'memos-sync:gzip:';
const COMPRESS_AT_BYTES = 220 * 1024;
const MAX_STATE_BYTES = 256 * 1024;

export async function encodeState(json: string): Promise<string> {
  const bytes = new Blob([json]);
  if (bytes.size <= COMPRESS_AT_BYTES) return json;

  const stream = bytes.stream().pipeThrough(new CompressionStream('gzip'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  const encoded = COMPRESSED_PREFIX + btoa(Array.from(compressed, (byte) => String.fromCharCode(byte)).join(''));
  if (encoded.length > MAX_STATE_BYTES && bytes.size > MAX_STATE_BYTES) {
    throw new Error('Memos Sync storage is full even after compression. Your draft has been kept.');
  }
  return encoded.length < bytes.size ? encoded : json;
}

export async function decodeState(value: string): Promise<string> {
  if (!value.startsWith(COMPRESSED_PREFIX)) return value;
  const bytes = Uint8Array.from(atob(value.slice(COMPRESSED_PREFIX.length)), (character) => character.charCodeAt(0));
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}
