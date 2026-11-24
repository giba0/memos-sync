import assert from 'node:assert/strict';
import { it, mock } from 'node:test';
import { hashLocalSnapshot } from '../engine/sync-engine';
import type { LocalNote, SyncMapping } from '../types';

it('preserves existing tagged mappings while importing untagged personal memos', async () => {
  let ready: (() => void) | undefined;
  const date = '2026-01-01T00:00:00Z';
  const oldNote: LocalNote = {
    id: 'old', content: 'old content', createdAt: date, updatedAt: date, attachments: [],
    state: 'NORMAL', pinned: false, visibility: 'PRIVATE',
  };
  const mapping: SyncMapping = {
    localNoteId: 'old', memoId: 'old', syncTag: 'sync', state: 'linked',
    lastSyncedAt: date, lastKnownLocalUpdatedAt: date, lastKnownMemoUpdatedAt: date,
    lastSyncedContentHash: '', lastSyncedSnapshotHash: hashLocalSnapshot(oldNote),
  };
  const config = { memosBaseUrl: 'https://memos.example.com', memosApiToken: 'test', syncTag: 'sync', autoSyncEnabled: false, pollIntervalMs: 300000 };
  const oldMemo = {
    name: 'memos/old', content: 'old content\n\n#sync', creator: 'users/me', tags: ['sync'],
    state: 'NORMAL', visibility: 'PRIVATE', pinned: false, attachments: [], createTime: date, updateTime: date,
  };
  const newMemo = { ...oldMemo, name: 'memos/new', content: 'new #personal', tags: ['personal'] };
  const foreignMemo = { ...newMemo, name: 'memos/foreign', creator: 'users/other' };
  const writes: string[] = [];
  Object.assign(globalThis, { PluginAPI: {
    onReady: (cb: () => void) => { ready = cb; },
    loadSyncedData: async () => JSON.stringify({ config, notes: [oldNote], mappingStore: { version: 1, mappings: [mapping], lastFullSyncAt: null } }),
    persistDataSynced: () => {}, showSnack: () => {}, showIndexHtmlAsView: () => {}, registerShortcut: () => {},
  } });
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const response = (data: object) => new Response(JSON.stringify(data));
    if (url.pathname === '/api/auth/me') return response({ user: { name: 'users/me' } });
    if (url.pathname === '/api/memos') return response({
      memos: url.searchParams.get('state') === 'ARCHIVED' ? [] : [oldMemo, newMemo, foreignMemo],
    });
    if (url.pathname === '/api/memos/old' && init?.method === 'PATCH') {
      writes.push(String(init.body));
      Object.assign(oldMemo, JSON.parse(String(init.body)));
      return response(oldMemo);
    }
    if (url.pathname === '/api/memos/old') return response(oldMemo);
    if (url.pathname === '/api/memos/new') return response(newMemo);
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  try {
    await import('../plugin');
    assert.ok(ready);
    ready();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const plugin = (globalThis as typeof globalThis & { __memosSyncPlugin: {
      runSync(): Promise<void>;
      updateNote(id: string, content: string): void;
      getState(): { notes: LocalNote[]; mappingStore: { mappings: SyncMapping[] } };
    } }).__memosSyncPlugin;
    await plugin.runSync();
    assert.equal(writes.length, 0);
    assert.deepEqual(plugin.getState().notes.map((note) => note.content).sort(), ['new #personal', 'old content']);
    assert.equal(plugin.getState().mappingStore.mappings.find((item) => item.memoId === 'new')?.syncTag, '');
    plugin.updateNote('old', 'edited');
    await plugin.runSync();
    assert.equal(oldMemo.content, 'edited\n\n#sync');
    assert.equal(plugin.getState().mappingStore.mappings.find((item) => item.memoId === 'old')?.syncTag, 'sync');
  } finally {
    mock.restoreAll();
    Reflect.deleteProperty(globalThis, 'PluginAPI');
    Reflect.deleteProperty(globalThis, '__memosSyncPlugin');
  }
});
