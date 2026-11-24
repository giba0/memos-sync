import { MemosApiError, MemosClient } from './memos-client';

export async function consumeEvents(
  client: MemosClient,
  signal: AbortSignal,
  onConnected: () => void,
  onChange: () => void,
): Promise<void> {
  const response = await client.openEventStream(signal);
  if (!response.body) throw new Error('Event stream is unavailable.');
  onConnected();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 65536) throw new Error('Memos event frame is too large.');
      let end: number;
      while ((end = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const separator = /^\r?\n\r?\n/.exec(buffer.slice(end))![0];
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + separator.length);
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, '')).join('\n');
        if (!data) continue;
        const event: unknown = JSON.parse(data);
        if (typeof event === 'object' && event !== null && 'type' in event &&
          (event.type === 'memo.changed' || event.type === 'space.changed')) onChange();
      }
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export function eventsUnavailable(error: unknown): boolean {
  return error instanceof MemosApiError && [401, 403, 404, 405, 410, 501].includes(error.status);
}
