import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeState, encodeState } from './state-storage';

test('fits a 260 KiB state under the host limit and restores notes and metadata', async () => {
  const state = JSON.stringify({
    notes: Array.from({ length: 400 }, (_, id) => ({
      id, content: 'Nota com caracteres Unicode — 📝 '.repeat(16),
      attachments: [{ name: 'drawing.excalidraw' }],
    })),
  });
  assert.ok(Buffer.byteLength(state) > 256 * 1024);
  const stored = await encodeState(state);
  assert.ok(Buffer.byteLength(stored) < 256 * 1024);
  assert.equal(await decodeState(stored), state);
});

test('keeps small states readable and loads legacy JSON unchanged', async () => {
  const legacy = '{"notes":[]}';
  assert.equal(await encodeState(legacy), legacy);
  assert.equal(await decodeState(legacy), legacy);
});
