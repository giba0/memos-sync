import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { MemosClient } from './memos-client';

const baseUrl = 'https://memos.example.com';
const json = (body: object, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('MemosClient API routes', () => {
  afterEach(() => mock.restoreAll());

  it('identifies current users across modern and legacy auth endpoints', async () => {
    for (const [route, body] of [
      ['/api/auth/me', { user: { name: 'users/modern' } }],
      ['/api/v1/auth/sessions/current', { user: { name: 'users/session' } }],
      ['/api/v1/auth/status', { name: 'users/legacy' }],
    ] as const) {
      mock.restoreAll();
      mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/memos' && route.startsWith('/api/v1')) return json({}, 404);
        if (url.pathname.endsWith('/memos')) return json({ memos: [] });
        return url.pathname === route ? json(body) : json({}, 404);
      });
      assert.equal(await new MemosClient(baseUrl, 'test').getCurrentUserName(), 'user' in body ? body.user.name : body.name);
    }
  });

  it('does not continue when current-user authentication fails', async () => {
    const paths: string[] = [];
    mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      return path.endsWith('/memos') ? json({ memos: [] }) : json({}, 401);
    });
    await assert.rejects(new MemosClient(baseUrl, 'test').getCurrentUserName(), /401/);
    assert.deepEqual(paths, ['/api/memos', '/api/auth/me']);
  });

  it('downloads attachments using authorization headers without redirects or tokens in URLs', async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      request = { url: String(input), init };
      return new Response('file', { headers: { 'Content-Type': 'text/plain' } });
    });
    const client = new MemosClient(baseUrl, 'test-token');
    assert.equal(await (await client.downloadAttachment('attachments/abc-123', 'a file.txt')).text(), 'file');
    assert.equal(request?.url, `${baseUrl}/file/attachments/abc-123/a%20file.txt`);
    assert.equal((request?.init?.headers as Record<string, string>).Authorization, 'Bearer test-token');
    assert.equal(request?.init?.redirect, 'error');
    await assert.rejects(client.downloadAttachment('attachments/../bad', 'x'), /Invalid attachment/);
  });

  it('rejects HTML responses when opening an attachment', async () => {
    mock.method(globalThis, 'fetch', async () => new Response('<html>login</html>', {
      headers: { 'Content-Type': 'text/html' },
    }));
    await assert.rejects(new MemosClient(baseUrl, 'test-token').downloadAttachment('attachments/a', 'x'), /returned HTML/);
  });

  it('fetches link metadata through the selected Memos API without sending credentials to the linked site', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      if (String(input).includes('/memos?pageSize=1')) return json({ memos: [] });
      return json({ title: 'Example', description: 'Description', image: 'https://example.com/image.png' });
    });
    const client = new MemosClient(baseUrl, 'test-token');
    const metadata = await client.getLinkMetadata('https://example.com/article?a=1&b=2');
    assert.equal(metadata.title, 'Example');
    const request = new URL(calls[1].url);
    assert.equal(request.origin, baseUrl);
    assert.equal(request.pathname, '/api/memos/-/linkMetadata');
    assert.equal(request.searchParams.get('url'), 'https://example.com/article?a=1&b=2');
    assert.equal(calls[1].init?.redirect, 'error');
    await assert.rejects(client.getLinkMetadata('javascript:alert(1)'), /Only HTTP/);
    await assert.rejects(client.getLinkMetadata('https://user:password@example.com'), /without credentials/);
    assert.equal(calls.length, 2);
  });

  it('reports unsupported and malformed link metadata responses', async () => {
    mock.method(globalThis, 'fetch', async (input: string | URL | Request) =>
      String(input).includes('/memos?pageSize=1') ? json({ memos: [] }) : json({ title: [] }));
    await assert.rejects(new MemosClient(baseUrl, 'test-token').getLinkMetadata('https://example.com'), /Invalid link metadata/);
  });

  it('uses the legacy metadata route and reports an unavailable endpoint', async () => {
    const calls: string[] = [];
    mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      if (url.pathname === '/api/memos') return json({}, 404);
      if (url.pathname === '/api/v1/memos') return json({ memos: [] });
      return json({ message: 'Not found' }, 404);
    });
    await assert.rejects(new MemosClient(baseUrl, 'test-token').getLinkMetadata('https://example.com'), /404/);
    assert.deepEqual(calls, ['/api/memos', '/api/v1/memos', '/api/v1/memos/-/linkMetadata']);
  });

  for (const prefix of ['/api', '/api/v1']) {
    it(`uses ${prefix} for all memo and attachment operations`, async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        if (prefix === '/api/v1' && url === `${baseUrl}/api/memos?pageSize=1`) {
          return json({ message: 'Not found' }, 404);
        }
        return json(url.includes('/attachments') && init?.method === 'POST'
          ? { name: 'attachments/a' }
          : url.includes('/memos/') || init?.method === 'POST'
            ? { name: 'memos/m' }
            : { memos: [] });
      });

      const client = new MemosClient(`${baseUrl}/`, 'test-token');
      assert.equal((await client.testConnection()).ok, true);
      await client.listMemos({ pageSize: 10, pageToken: 'next', updatedAfterUnixSeconds: 100 });
      await client.getMemo('m');
      await client.createMemo({ content: 'note' });
      await client.updateMemo('m', { content: 'updated' });
      await client.createAttachment({ filename: 'test.txt', type: 'text/plain', content: 'dGVzdA==' });
      await client.setMemoAttachments('m', [{ name: 'attachments/a' }]);
      await client.softDelete('m', true);

      const requests = calls.slice(prefix === '/api' ? 1 : 2);
      assert.deepEqual(requests.map(({ url, init }) => [url, init?.method ?? 'GET']), [
        [`${baseUrl}${prefix}/memos?pageSize=1`, 'GET'],
        [`${baseUrl}${prefix}/memos?pageSize=10&pageToken=next&filter=updated_ts+%3E%3D+100`, 'GET'],
        [`${baseUrl}${prefix}/memos/m`, 'GET'],
        [`${baseUrl}${prefix}/memos`, 'POST'],
        [`${baseUrl}${prefix}/memos/m?updateMask=content`, 'PATCH'],
        [`${baseUrl}${prefix}/attachments`, 'POST'],
        [`${baseUrl}${prefix}/memos/m/attachments`, 'PATCH'],
        [`${baseUrl}${prefix}/memos/m?force=true`, 'DELETE'],
      ]);
      assert.equal(requests[3].init?.body, JSON.stringify({ content: 'note' }));
      assert.equal(requests[6].init?.body, JSON.stringify({
        name: 'memos/m',
        attachments: [{ name: 'attachments/a' }],
      }));
    });
  }

  it('falls back to the legacy API when the modern path returns an HTML app shell', async () => {
    const calls: string[] = [];
    mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      calls.push(String(input));
      return String(input).includes('/api/v1/')
        ? json({ memos: [] })
        : new Response('<!DOCTYPE html><html></html>');
    });
    const client = new MemosClient(baseUrl, 'test-token');
    assert.deepEqual(await client.listMemos(), { memos: [] });
    assert.deepEqual(calls, [
      `${baseUrl}/api/memos?pageSize=1`,
      `${baseUrl}/api/v1/memos?pageSize=1`,
      `${baseUrl}/api/v1/memos?`,
    ]);
  });

  it('reports authentication errors without trying the legacy API', async () => {
    let calls = 0;
    mock.method(globalThis, 'fetch', async () => {
      calls++;
      return json({ message: 'Unauthorized' }, 401);
    });
    const result = await new MemosClient(baseUrl, 'test-token').testConnection();
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.match(result.message, /Unauthorized/);
    assert.equal(calls, 1);
  });

  it('rejects a successful response that is not a Memos list', async () => {
    let calls = 0;
    mock.method(globalThis, 'fetch', async () => {
      calls++;
      return json({ message: 'Unexpected response' });
    });
    const client = new MemosClient(baseUrl, 'test-token');
    await assert.rejects(client.createMemo({ content: 'note' }), /expected a memos array/);
    assert.equal(calls, 1);
  });

  it('falls back when the modern route returns 410', async () => {
    const calls: string[] = [];
    mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      calls.push(String(input));
      return calls.length === 1 ? json({ message: 'Gone' }, 410) : json({ memos: [] });
    });
    assert.equal((await new MemosClient(baseUrl, 'test-token').testConnection()).ok, true);
    assert.deepEqual(calls, [
      `${baseUrl}/api/memos?pageSize=1`,
      `${baseUrl}/api/v1/memos?pageSize=1`,
      `${baseUrl}/api/v1/memos?pageSize=1`,
    ]);
  });

  it('does not retry a failed write on another API route', async () => {
    const calls: string[] = [];
    mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      calls.push(String(input));
      return init?.method === 'POST' ? json({ message: 'Not found' }, 404) : json({ memos: [] });
    });
    const client = new MemosClient(baseUrl, 'test-token');
    await assert.rejects(client.createMemo({ content: 'note' }), /404/);
    assert.deepEqual(calls, [`${baseUrl}/api/memos?pageSize=1`, `${baseUrl}/api/memos`]);
  });

  it('retries discovery after a temporary network failure', async () => {
    let calls = 0;
    mock.method(globalThis, 'fetch', async () => {
      calls++;
      if (calls === 1) throw new Error('offline');
      return json({ memos: [] });
    });
    const client = new MemosClient(baseUrl, 'test-token');
    await assert.rejects(client.listMemos(), /offline/);
    assert.deepEqual(await client.listMemos(), { memos: [] });
    assert.equal(calls, 3);
  });

  it('fetches all pages in order', async () => {
    mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.searchParams.get('pageSize') === '1') return json({ memos: [] });
      return url.searchParams.get('pageToken')
        ? json({ memos: [{ name: 'memos/b' }] })
        : json({ memos: [{ name: 'memos/a' }], nextPageToken: 'next' });
    });
    const memos = await new MemosClient(baseUrl, 'test-token').listAllMemos();
    assert.deepEqual(memos.map((memo) => memo.name), ['memos/a', 'memos/b']);
  });

  it('fails instead of returning partial results if a later page fails', async () => {
    mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.searchParams.get('pageSize') === '1') return json({ memos: [] });
      return url.searchParams.has('pageToken')
        ? json({ message: 'Unavailable' }, 503)
        : json({ memos: [{ name: 'memos/a' }], nextPageToken: 'next' });
    });
    await assert.rejects(new MemosClient(baseUrl, 'test-token').listAllMemos(), /503/);
  });

  it('rejects repeated pagination tokens', async () => {
    mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      const url = new URL(String(input));
      return url.searchParams.get('pageSize') === '1'
        ? json({ memos: [] })
        : json({ memos: [], nextPageToken: 'same' });
    });
    await assert.rejects(new MemosClient(baseUrl, 'test-token').listAllMemos(), /repeated page token/);
  });
});
