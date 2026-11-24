import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { MemosClient } from './memos-client';
import { fetchRemoteMemosForSync } from './remote-memos';

const json = (body: object, status = 200): Response => new Response(JSON.stringify(body), { status });
const baseUrl = 'https://memos.example.com';

describe('fetchRemoteMemosForSync', () => {
  afterEach(() => mock.restoreAll());

  it('fetches linked memos missing from the list, including archived or untagged ones', async () => {
    const requests: string[] = [];
    mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/memos/archived')) return json({ name: 'memos/archived', state: 'ARCHIVED', tags: [] });
      return json({ memos: [{ name: 'memos/visible' }] });
    });
    const memos = await fetchRemoteMemosForSync(new MemosClient(baseUrl, 'test'), ['visible', 'archived', 'archived']);
    assert.deepEqual(memos.map((memo) => memo.name), ['memos/visible', 'memos/archived']);
    assert.equal(requests.filter((url) => url.endsWith('/memos/archived')).length, 1);
  });

  it('reports the absence to the sync engine for explicit confirmation', async () => {
    mock.method(globalThis, 'fetch', async (input: string | URL | Request) =>
      String(input).endsWith('/memos/missing') ? json({ message: 'Not found' }, 404) : json({ memos: [] }));
    assert.deepEqual(await fetchRemoteMemosForSync(new MemosClient(baseUrl, 'test'), ['missing']), []);
  });

  it('does not return partial results when the archived listing fails', async () => {
    mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.searchParams.get('state') === 'ARCHIVED') return json({ message: 'Unavailable' }, 503);
      return json({ memos: [{ name: 'memos/visible' }] });
    });
    await assert.rejects(fetchRemoteMemosForSync(new MemosClient(baseUrl, 'test'), []), /503/);
  });

  it('stops synchronization for errors other than not found', async () => {
    mock.method(globalThis, 'fetch', async (input: string | URL | Request) =>
      String(input).endsWith('/memos/hidden') ? json({ message: 'Forbidden' }, 403) : json({ memos: [] }));
    await assert.rejects(fetchRemoteMemosForSync(new MemosClient(baseUrl, 'test'), ['hidden']), /403/);
  });

});
