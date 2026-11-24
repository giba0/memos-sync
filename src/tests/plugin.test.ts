import assert from 'node:assert/strict';
import { it, mock } from 'node:test';
import type { LocalNote, SyncMapping } from '../types';
import type { Memo } from '../types/memos';

interface TestPlugin {
  getState(): { notes: LocalNote[]; mappingStore: { mappings: SyncMapping[] }; syncLog: Array<{ results: Array<{ action: string }> }> };
  updateNoteMetadata(id: string, metadata: { state?: 'NORMAL' | 'ARCHIVED'; pinned?: boolean; visibility?: 'PRIVATE' | 'PROTECTED' | 'PUBLIC' }): void;
  removeAttachment(id: string, attachmentId: string): void;
  createNote(): LocalNote;
  updateNote(id: string, content: string): void;
  updateConfig(config: object): void;
  addAttachment(id: string, attachment: object): void;
  runSync(config?: object): Promise<void>;
  confirmRemoteDeletion(id: string, memoId: string): void;
  resolveConflict(id: string, memoId: string, winner: 'local' | 'remote'): Promise<void>;
}

it('syncs archive, pin and last attachment deletion while preserving missing notes', async () => {
  let ready: (() => void) | undefined;
  const snacks: string[] = [];
  Object.assign(globalThis, {
    PluginAPI: {
      onReady: (cb: () => void) => { ready = cb; },
      loadSyncedData: async () => null,
      persistDataSynced: () => {},
      showSnack: ({ msg }: { msg: string }) => snacks.push(msg),
      showIndexHtmlAsView: () => {},
      registerShortcut: () => {},
    },
  });

  const memo: Memo = {
    name: 'memos/one', content: 'hello without a tag', tags: [], state: 'NORMAL',
    pinned: false, visibility: 'PRIVATE', creator: 'users/test',
    createTime: '2026-01-01T00:00:00Z', updateTime: '2026-01-01T00:00:00Z',
    attachments: [{ name: 'attachments/a', filename: 'a.txt', type: 'text/plain', size: '1', createTime: '2026-01-01T00:00:00Z' }],
  };
  let missing = false;
  let failLink = false;
  let eventStream: ReadableStreamDefaultController<Uint8Array> | undefined;
  let closeEventStream: (() => void) | undefined;
  let unblock: (() => void) | undefined;
  let notifyBlocked: (() => void) | undefined;
  let blockNextList = false;
  const uploaded = { name: 'attachments/uploaded', filename: 'upload.txt', type: 'text/plain', size: '1', createTime: '2026-01-01T00:00:00Z' };
  const calls: Array<{ method: string; path: string; body: string }> = [];
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : '';
    calls.push({ method, path: url.pathname, body });
    const response = (data: object, status = 200) => new Response(JSON.stringify(data), { status });
    if (url.pathname === '/api/auth/me') return response({ user: { name: 'users/test' } });
    if (url.pathname === '/api/sse') {
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          eventStream = controller;
          let closed = false;
          closeEventStream = () => { if (!closed) { closed = true; controller.close(); } };
          init?.signal?.addEventListener('abort', closeEventStream, { once: true });
        },
      }), { headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (url.pathname === '/api/memos' && method === 'GET') {
      if (blockNextList) {
        blockNextList = false;
        await new Promise<void>((resolve) => { unblock = resolve; notifyBlocked?.(); });
      }
      const state = url.searchParams.get('state') ?? 'NORMAL';
      const foreign = { ...memo, name: 'memos/foreign', creator: 'users/other' };
      return response({ memos: !missing && memo.state === state ? [memo, foreign] : [] });
    }
    if (url.pathname === '/api/memos' && method === 'POST') {
      Object.assign(memo, { name: 'memos/new', ...JSON.parse(body), tags: ['sync'], state: 'NORMAL', pinned: false, visibility: 'PRIVATE', attachments: [] });
      missing = false;
      return response(memo);
    }
    if (url.pathname === '/api/attachments:upload' && method === 'POST') return response({ message: 'Not found' }, 404);
    if (url.pathname === '/api/attachments' && method === 'POST') return response(uploaded);
    if (url.pathname === `/api/${memo.name}` && method === 'GET') {
      return missing ? response({ message: 'not found' }, 404) : response(memo);
    }
    if (url.pathname === `/api/${memo.name}` && method === 'PATCH') {
      Object.assign(memo, JSON.parse(body));
      memo.updateTime = new Date(Date.parse(memo.updateTime) + 1000).toISOString();
      return response(memo);
    }
    if (url.pathname === `/api/${memo.name}/attachments` && method === 'PATCH') {
      if (failLink) {
        failLink = false;
        return response({ message: 'Link failed' }, 503);
      }
      const refs = JSON.parse(body) as { attachments: Array<{ name: string }> };
      memo.attachments = refs.attachments.map((ref) => [...memo.attachments, uploaded].find((item) => item.name === ref.name))
        .filter((item): item is typeof uploaded => item !== undefined);
      return response({});
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  });

  try {
    await import('../plugin');
    assert.ok(ready);
    ready();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const plugin = (globalThis as typeof globalThis & { __memosSyncPlugin: TestPlugin }).__memosSyncPlugin;
    await plugin.runSync({ memosBaseUrl: 'https://memos.example.com', memosApiToken: 'test', syncTag: '#sync', autoSyncEnabled: false, pollIntervalMs: 300000 });
    let note = plugin.getState().notes[0];
    assert.equal(plugin.getState().notes.length, 1);
    assert.equal(note.content, 'hello without a tag');
    assert.equal(note.state, 'NORMAL');
    assert.equal(note.attachments.length, 1);
    memo.content = 'updated remotely';
    memo.updateTime = '2026-01-01T01:00:00Z';
    await plugin.runSync();
    assert.equal(plugin.getState().notes[0].content, 'updated remotely');
    assert.equal(plugin.getState().mappingStore.mappings[0].state, 'linked');
    memo.creator = 'users/other';
    plugin.updateNote(note.id, 'local change while ownership changed');
    await plugin.runSync();
    assert.equal(memo.content, 'updated remotely');
    assert.ok(snacks.some((message) => message.includes('another Memos account')));
    memo.creator = 'users/test';
    plugin.updateNote(note.id, 'updated remotely');

    plugin.updateNoteMetadata(note.id, { state: 'ARCHIVED', pinned: true });
    plugin.removeAttachment(note.id, note.attachments[0].id);
    await plugin.runSync();
    assert.equal(memo.state, 'ARCHIVED');
    assert.equal(memo.pinned, true);
    assert.equal(memo.attachments.length, 0);
    assert.ok(calls.some((call) => call.path.endsWith('/attachments') && call.body.includes('"attachments":[]')));

    memo.state = 'NORMAL';
    memo.pinned = false;
    memo.updateTime = '2026-01-02T00:00:00Z';
    await plugin.runSync();
    note = plugin.getState().notes[0];
    assert.equal(note.state, 'NORMAL');
    assert.equal(note.pinned, false);

    plugin.updateNoteMetadata(note.id, { visibility: 'PROTECTED' });
    await plugin.runSync();
    assert.equal(memo.visibility, 'PROTECTED');

    plugin.updateNoteMetadata(note.id, { state: 'ARCHIVED' });
    memo.pinned = true;
    await plugin.runSync();
    assert.equal(plugin.getState().mappingStore.mappings[0].state, 'conflict');
    await plugin.runSync();
    assert.equal(plugin.getState().mappingStore.mappings[0].state, 'conflict');
    await plugin.resolveConflict(note.id, 'one', 'remote');
    assert.equal(plugin.getState().notes[0].state, 'NORMAL');
    assert.equal(plugin.getState().notes[0].pinned, true);

    missing = true;
    await plugin.runSync();
    assert.equal(plugin.getState().notes.length, 1);
    assert.equal(plugin.getState().mappingStore.mappings[0].state, 'remote-missing');
    assert.ok(snacks.some((message) => message.includes('error')));
    plugin.confirmRemoteDeletion(note.id, 'one');
    assert.equal(plugin.getState().notes.length, 0);
    assert.equal(plugin.getState().mappingStore.mappings.length, 0);

    const newNote = plugin.createNote();
    plugin.updateNote(newNote.id, 'new note');
    plugin.addAttachment(newNote.id, { name: '', filename: 'upload.txt', mimeType: 'text/plain', size: 1, base64Content: 'YQ==' });
    failLink = true;
    await plugin.runSync();
    assert.equal(plugin.getState().mappingStore.mappings[0].memoId, 'new');
    assert.equal(plugin.getState().notes[0].attachments[0].name, uploaded.name);
    await plugin.runSync();
    assert.equal(plugin.getState().mappingStore.mappings[0].state, 'linked');
    assert.equal(memo.attachments[0].name, uploaded.name);
    assert.equal(calls.filter((call) => call.method === 'POST' && call.path === '/api/memos').length, 1);
    assert.equal(memo.content, 'new note');
    assert.equal(calls.filter((call) => call.method === 'POST' && call.path === '/api/attachments').length, 1);

    const config = { memosBaseUrl: 'https://memos.example.com', memosApiToken: 'test', syncTag: 'sync', autoSyncEnabled: true, pollIntervalMs: 300000 };
    plugin.updateConfig(config);
    try {
      for (let attempt = 0; !eventStream && attempt < 50; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
      assert.ok(eventStream, 'SSE stream should connect');
      const blocked = new Promise<void>((resolve) => { notifyBlocked = resolve; });
      blockNextList = true;
      const manual = plugin.runSync();
      await blocked;
      const before = calls.length;
      const frame = new TextEncoder().encode('data: {"type":"memo.changed"}\n\n');
      eventStream.enqueue(frame);
      eventStream.enqueue(frame);
      await new Promise((resolve) => setTimeout(resolve, 1600));
      assert.equal(calls.slice(before).filter((call) => call.path === '/api/memos').length, 0, 'events must not overlap a running sync');
      unblock?.();
      await manual;
      const afterManual = calls.length;
      await new Promise((resolve) => setTimeout(resolve, 1800));
      assert.ok(calls.slice(afterManual).some((call) => call.path === '/api/memos'), 'pending events trigger reconciliation');
      closeEventStream?.();
      eventStream = undefined;
      const beforeReconnect = calls.length;
      for (let attempt = 0; !eventStream && attempt < 120; attempt++) await new Promise((resolve) => setTimeout(resolve, 100));
      assert.ok(eventStream, 'SSE should reconnect');
      await new Promise((resolve) => setTimeout(resolve, 1800));
      assert.ok(calls.slice(beforeReconnect).some((call) => call.path === '/api/memos'), 'reconnect triggers reconciliation');
    } finally {
      unblock?.();
      plugin.updateConfig({ ...config, autoSyncEnabled: false });
    }
  } finally {
    mock.restoreAll();
    Reflect.deleteProperty(globalThis, 'PluginAPI');
    Reflect.deleteProperty(globalThis, '__memosSyncPlugin');
  }
});
