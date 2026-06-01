import type {
  Memo,
  ConnectionTestResult,
  CreateAttachmentRequest,
  CreateMemoRequest,
  UpdateMemoRequest,
  ListMemosResponse,
  MemoAttachment,
  SetMemoAttachmentsRequest,
} from '../types/memos';

export class MemosClient {
  private baseUrl: string;
  private token: string;

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

  private url(path: string): string {
    return `${this.baseUrl}/api/v1${path}`;
  }

  private async createErrorMessage(res: Response): Promise<string> {
    const responseText = (await res.text()).trim();
    const compactText = responseText.replace(/\s+/g, ' ').slice(0, 200);
    if (compactText.startsWith('<!DOCTYPE') || compactText.startsWith('<html')) {
      return `Memos API error: ${res.status} ${res.statusText} - Received HTML instead of JSON. Check the configured base URL or reverse proxy routing for /api/v1.`;
    }
    return compactText
      ? `Memos API error: ${res.status} ${res.statusText} - ${compactText}`
      : `Memos API error: ${res.status} ${res.statusText}`;
  }

  private async ensureOk(res: Response): Promise<void> {
    if (!res.ok) {
      throw new Error(await this.createErrorMessage(res));
    }
  }

  private async parseJson<T>(res: Response): Promise<T> {
    const text = await res.text();
    const compactText = text.trim().replace(/\s+/g, ' ');
    if (compactText.startsWith('<!DOCTYPE') || compactText.startsWith('<html')) {
      throw new Error(
        'Received HTML instead of JSON. Check the configured Memos base URL or reverse proxy routing for /api/v1.',
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
      const res = await fetch(this.url('/memos?pageSize=1'), {
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
        status: 0,
        message: `Network error: ${message}`,
      };
    }
  }

  async listMemos(options?: {
    pageSize?: number;
    pageToken?: string;
    updatedAfterUnixSeconds?: number;
  }): Promise<ListMemosResponse> {
    const params = new URLSearchParams();
    if (options?.pageSize) params.set('pageSize', String(options.pageSize));
    if (options?.pageToken) params.set('pageToken', options.pageToken);

    const filters: string[] = [];
    if (options?.updatedAfterUnixSeconds) {
      filters.push(`updated_ts >= ${options.updatedAfterUnixSeconds}`);
    }
    if (filters.length > 0) {
      params.set('filter', filters.join(' && '));
    }

    const res = await fetch(this.url(`/memos?${params.toString()}`), {
      headers: this.headers(),
    });

    await this.ensureOk(res);

    return this.parseJson<ListMemosResponse>(res);
  }

  async getMemo(memoId: string): Promise<Memo> {
    const res = await fetch(this.url(`/memos/${memoId}`), {
      headers: this.headers(),
    });
    await this.ensureOk(res);
    return this.parseJson<Memo>(res);
  }

  async createMemo(request: CreateMemoRequest): Promise<Memo> {
    const res = await fetch(this.url('/memos'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(request),
    });
    await this.ensureOk(res);
    return this.parseJson<Memo>(res);
  }

  async updateMemo(memoId: string, request: UpdateMemoRequest): Promise<Memo> {
    const updateMask = Object.keys(request).join(',');
    const res = await fetch(this.url(`/memos/${memoId}?updateMask=${updateMask}`), {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify(request),
    });
    await this.ensureOk(res);
    return this.parseJson<Memo>(res);
  }

  async createAttachment(request: CreateAttachmentRequest): Promise<MemoAttachment> {
    const res = await fetch(this.url('/attachments'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(request),
    });
    await this.ensureOk(res);
    return this.parseJson<MemoAttachment>(res);
  }

  async setMemoAttachments(memoId: string, attachments: SetMemoAttachmentsRequest['attachments']): Promise<void> {
    const res = await fetch(this.url(`/memos/${memoId}/attachments`), {
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
    const res = await fetch(this.url(`/memos/${memoId}${params}`), {
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
