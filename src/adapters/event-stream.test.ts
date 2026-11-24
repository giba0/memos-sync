import assert from 'node:assert/strict';
import { afterEach, it, mock } from 'node:test';
import { MemosClient } from './memos-client';
import { consumeEvents, eventsUnavailable } from './event-stream';

afterEach(() => mock.restoreAll());

it('reads fragmented generic SSE events using authenticated streaming', async () => {
  let authorization = '';
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes('/memos?')) return new Response('{"memos":[]}');
    authorization = (init?.headers as Record<string, string>).Authorization;
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({
      start(controller) {
        for (const part of [': heartbeat\n\ndata: {"type":"memo.', 'changed"}\n\n', 'data: {"type":"space.changed"}\r\n\r\n']) {
          controller.enqueue(encoder.encode(part));
        }
        controller.close();
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } });
  });
  let count = 0;
  let connected = 0;
  await consumeEvents(new MemosClient('https://memos.example.com', 'test'), new AbortController().signal, () => connected++, () => count++);
  assert.equal(authorization, 'Bearer test');
  assert.equal(connected, 1);
  assert.equal(count, 2);
});

it('marks missing SSE as unavailable for polling fallback', async () => {
  mock.method(globalThis, 'fetch', async (input: string | URL | Request) =>
    String(input).includes('/memos?') ? new Response('{"memos":[]}') : new Response('{}', { status: 404 }));
  await assert.rejects(
    consumeEvents(new MemosClient('https://memos.example.com', 'test'), new AbortController().signal, () => {}, () => {}),
    eventsUnavailable,
  );
});
