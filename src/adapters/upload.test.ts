import assert from 'node:assert/strict';
import { afterEach, it, mock } from 'node:test';
import { MemosClient } from './memos-client';
import { uploadAttachment } from './upload';
import type { LocalAttachment } from '../types';

afterEach(() => mock.restoreAll());
const makeAttachment = (): LocalAttachment => ({
  id: 'local', name: '', filename: 'file.txt', mimeType: 'text/plain', size: 5,
  base64Content: 'aGVsbG8=', createdAt: '2026-01-01T00:00:00Z',
});
const json = (body: object, status = 200): Response => new Response(JSON.stringify(body), { status });
const uploaded = { name: 'attachments/result', filename: 'file.txt', type: 'text/plain', size: '5', createTime: '2026-01-01T00:00:00Z' };

it('resumes chunks after an uncertain response and never writes bytes twice', async () => {
  let committed = 0;
  let savedId = '';
  let fail = true;
  const writes: number[] = [];
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/memos') return json({ memos: [] });
    const body = JSON.parse(String(init?.body)) as { spec?: { attachmentId: string }; data?: string; writeOffset: string; finishWrite?: boolean };
    if (body.spec) { savedId = body.spec.attachmentId; return json({ uploadId: 'session', committedSize: '0', maxChunkSize: 2 }); }
    if (!body.data && !body.finishWrite) return json({ uploadId: 'session', committedSize: String(committed), maxChunkSize: 2 });
    assert.equal(Number(body.writeOffset), committed);
    const count = atob(body.data || '').length;
    committed += count;
    writes.push(count);
    if (fail) { fail = false; throw new Error('connection lost'); }
    return json({ uploadId: 'session', committedSize: String(committed), maxChunkSize: 2, ...(body.finishWrite ? { attachment: { ...uploaded, name: `attachments/${savedId}` } } : {}) });
  });
  const attachment = makeAttachment();
  const client = new MemosClient('https://memos.example.com', 'test');
  const save = (upload: NonNullable<LocalAttachment['upload']>) => { attachment.upload = upload; };
  await assert.rejects(uploadAttachment(client, attachment, save), /connection lost/);
  assert.equal(attachment.upload?.uploadId, 'session');
  assert.equal((await uploadAttachment(client, attachment, save)).name, `attachments/${savedId}`);
  assert.deepEqual(writes, [2, 2, 1]);
});

it('resolves an uncertain finalization by the stable attachment id', async () => {
  let savedId = '';
  let completed = false;
  let finishRequests = 0;
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/memos') return json({ memos: [] });
    if (url.pathname === `/api/attachments/${savedId}`) return completed ? json({ ...uploaded, name: `attachments/${savedId}` }) : json({}, 404);
    const body = JSON.parse(String(init?.body)) as { spec?: { attachmentId: string }; finishWrite?: boolean };
    if (body.spec) { savedId = body.spec.attachmentId; return json({ uploadId: 'session', maxChunkSize: 10 }); }
    if (body.finishWrite) { completed = true; finishRequests++; throw new Error('response lost'); }
    return json({ uploadId: 'session', maxChunkSize: 10 });
  });
  const attachment = makeAttachment();
  const client = new MemosClient('https://memos.example.com', 'test');
  const save = (upload: NonNullable<LocalAttachment['upload']>) => { attachment.upload = upload; };
  await assert.rejects(uploadAttachment(client, attachment, save), /response lost/);
  assert.equal(attachment.upload?.finalizing, true);
  assert.equal((await uploadAttachment(client, attachment, save)).name, `attachments/${savedId}`);
  assert.equal(finishRequests, 1);
});

it('does not retry an uncertain legacy upload', async () => {
  let posts = 0;
  mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/memos') return json({ memos: [] });
    if (url.pathname.endsWith(':upload')) return json({}, 404);
    posts++;
    throw new Error('connection lost');
  });
  const attachment = makeAttachment();
  const client = new MemosClient('https://memos.example.com', 'test');
  const save = (upload: NonNullable<LocalAttachment['upload']>) => { attachment.upload = upload; };
  await assert.rejects(uploadAttachment(client, attachment, save), /connection lost/);
  await assert.rejects(uploadAttachment(client, attachment, save), /may have succeeded/);
  assert.equal(posts, 1);
});

it('restarts an expired session only if finalization was never attempted', async () => {
  const attachment = makeAttachment();
  attachment.upload = { attachmentId: 'original-attachment-id', uploadId: 'expired', committedSize: 2 };
  let newSessions = 0;
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/memos') return json({ memos: [] });
    const body = JSON.parse(String(init?.body)) as { uploadId?: string; spec?: { attachmentId: string }; finishWrite?: boolean };
    if (body.uploadId === 'expired') return json({}, 404);
    if (body.spec) { newSessions++; return json({ uploadId: 'new', maxChunkSize: 10 }); }
    return json({ uploadId: 'new', maxChunkSize: 10, committedSize: '5', attachment: { ...uploaded, name: `attachments/${attachment.upload?.attachmentId}` } });
  });
  const client = new MemosClient('https://memos.example.com', 'test');
  await uploadAttachment(client, attachment, (upload) => { attachment.upload = upload; });
  assert.equal(newSessions, 1);
});

it('does not restart an expired session after an uncertain finalization', async () => {
  const attachment = makeAttachment();
  attachment.upload = { attachmentId: 'original-attachment-id', uploadId: 'expired', finalizing: true };
  let starts = 0;
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/memos') return json({ memos: [] });
    if (init?.body && String(init.body).includes('"spec"')) starts++;
    return json({}, 404);
  });
  await assert.rejects(uploadAttachment(new MemosClient('https://memos.example.com', 'test'), attachment, (upload) => { attachment.upload = upload; }), /expired after finalization/);
  assert.equal(starts, 0);
});
