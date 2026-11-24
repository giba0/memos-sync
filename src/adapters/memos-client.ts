import type {
  Memo,
  ConnectionTestResult,
  CreateAttachmentRequest,
  CreateMemoRequest,
  UpdateMemoRequest,
  ListMemosResponse,
  MemoAttachment,
  SetMemoAttachmentsRequest,
  LinkMetadata,
} from '../types/memos';

export class MemosApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export class MemosClient {
  private baseUrl: string;
  private token: string;
  private apiPrefix?: Promise<string>;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  private async resolveApiPrefix(): Promise<string> {
    const probe = async (prefix: string): Promise<Response> => fetch(
      `${this.baseUrl}${prefix}/memos?pageSize=1`,
      { headers: this.headers() },
    );
    const modern = await probe('/api');
    const body = (await modern.clone().text()).trim().toLowerCase();
    const isHtml = body.startsWith('<!doctype') || body.startsWith('<html');
    if (modern.status !== 404 && modern.status !== 410 && !(modern.ok && isHtml)) {
      await this.validateProbe(modern);
      return '/api';
    }

    const legacy = await probe('/api/v1');
    await this.validateProbe(legacy);
    return '/api/v1';
  }

  private async validateProbe(res: Response): Promise<void> {
    await this.ensureOk(res);
    const data = await this.parseJson<unknown>(res);
    if (typeof data !== 'object' || data === null || !('memos' in data) || !Array.isArray(data.memos)) {
      throw new Error('Invalid Memos API response: expected a memos array. Check the configured base URL or reverse proxy.');
    }
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    if (!this.apiPrefix) {
      this.apiPrefix = this.resolveApiPrefix().catch((error: unknown) => {
        this.apiPrefix = undefined;
        throw error;
      });
    }
    return fetch(`${this.baseUrl}${await this.apiPrefix}${path}`, init);
  }

  private async createErrorMessage(res: Response): Promise<string> {
    const responseText = (await res.text()).trim();
    const compactText = responseText.replace(/\s+/g, ' ').slice(0, 200);
    if (compactText.startsWith('<!DOCTYPE') || compactText.startsWith('<html')) {
      return `Memos API error: ${res.status} ${res.statusText} - Received HTML instead of JSON. Check the configured base URL or reverse proxy routing for /api and /api/v1.`;
    }
    return compactText
      ? `Memos API error: ${res.status} ${res.statusText} - ${compactText}`
      : `Memos API error: ${res.status} ${res.statusText}`;
  }

  private async ensureOk(res: Response): Promise<void> {
    if (!res.ok) {
      throw new MemosApiError(await this.createErrorMessage(res), res.status);
    }
  }

  private async parseJson<T>(res: Response): Promise<T> {
    const text = await res.text();
    const compactText = text.trim().replace(/\s+/g, ' ');
    if (compactText.startsWith('<!DOCTYPE') || compactText.startsWith('<html')) {
      throw new Error(
        'Received HTML instead of JSON. Check the configured Memos base URL or reverse proxy routing for /api and /api/v1.',
      );
    }

    try {
      return JSON.parse(text) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid JSON response';
      throw new Error(`${message}. Response preview: ${compactText.slice(0, 200)}`);
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const res = await this.request('/memos?pageSize=1', {
        headers: this.headers(),
      });

      if (res.ok) {
        return {
          ok: true,
          status: res.status,
          message: 'Connection successful.',
        };
      }

      return {
        ok: false,
        status: res.status,
        message: await this.createErrorMessage(res),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown network error';
      return {
        ok: false,
        status: error instanceof MemosApiError ? error.status : 0,
        message: error instanceof MemosApiError ? message : `Network error: ${message}`,
      };
    }
  }

  async listMemos(options?: {
    pageSize?: number;
    pageToken?: string;
    updatedAfterUnixSeconds?: number;
    state?: 'NORMAL' | 'ARCHIVED';
  }): Promise<ListMemosResponse> {
    const params = new URLSearchParams();
    if (options?.pageSize) params.set('pageSize', String(options.pageSize));
    if (options?.pageToken) params.set('pageToken', options.pageToken);
    if (options?.state) params.set('state', options.state);

    const filters: string[] = [];
    if (options?.updatedAfterUnixSeconds) {
      filters.push(`updated_ts >= ${options.updatedAfterUnixSeconds}`);
    }
    if (filters.length > 0) {
      params.set('filter', filters.join(' && '));
    }

    const res = await this.request(`/memos?${params.toString()}`, {
      headers: this.headers(),
    });

    await this.ensureOk(res);

    return this.parseJson<ListMemosResponse>(res);
  }

  async listAllMemos(state?: 'NORMAL' | 'ARCHIVED'): Promise<Memo[]> {
    const memos: Memo[] = [];
    const seenTokens = new Set<string>();
    let pageToken: string | undefined;
    do {
      const page = await this.listMemos({ pageSize: 1000, pageToken, state });
      if (!Array.isArray(page.memos)) {
        throw new Error('Invalid Memos API response: expected a memos array.');
      }
      memos.push(...page.memos);
      pageToken = page.nextPageToken || undefined;
      if (pageToken && seenTokens.has(pageToken)) {
        throw new Error('Memos API returned a repeated page token; synchronization was stopped.');
      }
      if (pageToken) seenTokens.add(pageToken);
    } while (pageToken);
    return memos;
  }

  async getMemo(memoId: string): Promise<Memo> {
    const res = await this.request(`/memos/${memoId}`, {
      headers: this.headers(),
    });
    await this.ensureOk(res);
    return this.parseJson<Memo>(res);
  }

  async getCurrentUserName(): Promise<string> {
    const routes: Array<{ path: string; method: 'GET' | 'POST' }> = [
      { path: '/auth/me', method: 'GET' },
      { path: '/auth/sessions/current', method: 'GET' },
      { path: '/auth/status', method: 'POST' },
    ];
    for (const route of routes) {
      const res = await this.request(route.path, {
        method: route.method,
        headers: this.headers(),
        ...(route.method === 'POST' ? { body: '{}' } : {}),
      });
      if ([404, 405, 410, 501].includes(res.status)) continue;
      await this.ensureOk(res);
      const data = await this.parseJson<{ name?: unknown; user?: { name?: unknown } }>(res);
      const name = data.user?.name ?? data.name;
      if (typeof name !== 'string' || !/^users\/[^/]+$/.test(name)) {
        throw new Error('Cannot identify the Memos account. Synchronization stopped to protect other users’ memos.');
      }
      return name;
    }
    throw new Error('The Memos server does not expose a supported current-user endpoint. Synchronization stopped to protect other users’ memos.');
  }

  async getLinkMetadata(url: string): Promise<LinkMetadata> {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      throw new Error('Invalid link URL.');
    }
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
      throw new Error('Only HTTP and HTTPS links without credentials can be previewed.');
    }
    const params = new URLSearchParams({ url: target.href });
    const res = await this.request(`/memos/-/linkMetadata?${params.toString()}`, {
      headers: this.headers(),
      redirect: 'error',
    });
    await this.ensureOk(res);
    const data = await this.parseJson<Partial<LinkMetadata>>(res);
    if (typeof data !== 'object' || data === null ||
      [data.title, data.description, data.image].some((value) => value !== undefined && typeof value !== 'string')) {
      throw new Error('Invalid link metadata response from Memos.');
    }
    return { url: target.href, title: data.title ?? '', description: data.description ?? '', image: data.image ?? '' };
  }

  async createMemo(request: CreateMemoRequest): Promise<Memo> {
    const res = await this.request('/memos', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(request),
    });
    await this.ensureOk(res);
    return this.parseJson<Memo>(res);
  }

  async updateMemo(memoId: string, request: UpdateMemoRequest): Promise<Memo> {
    const updateMask = Object.keys(request).join(',');
    const res = await this.request(`/memos/${memoId}?updateMask=${updateMask}`, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify(request),
    });
    await this.ensureOk(res);
    return this.parseJson<Memo>(res);
  }

  async createAttachment(request: CreateAttachmentRequest): Promise<MemoAttachment> {
    const res = await this.request('/attachments', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(request),
    });
    await this.ensureOk(res);
    return this.parseJson<MemoAttachment>(res);
  }

  async getAttachment(id: string): Promise<MemoAttachment> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,34}[a-zA-Z0-9]$/.test(id)) throw new Error('Invalid attachment ID.');
    const response = await this.request(`/attachments/${id}`, { headers: this.headers() });
    await this.ensureOk(response);
    return this.parseJson<MemoAttachment>(response);
  }

  async uploadAttachmentPart(body: object): Promise<{
    uploadId: string;
    committedSize?: string;
    maxChunkSize: number;
    attachment?: MemoAttachment;
  }> {
    const response = await this.request('/attachments:upload', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    await this.ensureOk(response);
    return this.parseJson(response);
  }

  async openEventStream(signal: AbortSignal): Promise<Response> {
    const response = await this.request('/sse', {
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'text/event-stream' },
      signal,
      redirect: 'error',
    });
    await this.ensureOk(response);
    if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream') || !response.body) {
      throw new Error('Memos did not provide a streaming event response.');
    }
    return response;
  }

  async downloadAttachment(attachmentName: string, filename: string): Promise<Blob> {
    const id = MemosClient.extractAttachmentId(attachmentName);
    if (!/^attachments\/[A-Za-z0-9_-]+$/.test(attachmentName)) {
      throw new Error('Invalid attachment resource name.');
    }
    const base = new URL(this.baseUrl);
    if (base.protocol !== 'https:' && base.protocol !== 'http:') {
      throw new Error('The Memos URL must use HTTP or HTTPS.');
    }
    const response = await fetch(this.buildAttachmentUrl(`attachments/${id}`, filename), {
      headers: { Authorization: `Bearer ${this.token}` },
      redirect: 'error',
    });
    await this.ensureOk(response);
    if ((response.headers.get('content-type') || '').toLowerCase().includes('text/html')) {
      throw new Error('Memos returned HTML instead of an attachment. Check access and proxy settings.');
    }
    return response.blob();
  }

  async setMemoAttachments(memoId: string, attachments: SetMemoAttachmentsRequest['attachments']): Promise<void> {
    const res = await this.request(`/memos/${memoId}/attachments`, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify({
        name: `memos/${memoId}`,
        attachments,
      }),
    });
    await this.ensureOk(res);
  }

  async softDelete(memoId: string, force = false): Promise<void> {
    const params = force ? '?force=true' : '';
    const res = await this.request(`/memos/${memoId}${params}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    await this.ensureOk(res);
  }

  // Resource name format: "memos/{id}" -> "{id}"
  static extractId(name: string): string {
    return name.replace(/^memos\//, '');
  }

  buildAttachmentUrl(attachmentName: string, filename: string): string {
    return `${this.baseUrl}/file/attachments/${MemosClient.extractAttachmentId(attachmentName)}/${encodeURIComponent(filename)}`;
  }

  static extractAttachmentId(name: string): string {
    return name.replace(/^attachments\//, '');
  }
}
