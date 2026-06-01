export type MemoVisibility = 'PRIVATE' | 'PROTECTED' | 'PUBLIC';
export type MemoState = 'NORMAL' | 'ARCHIVED';

export interface MemoAttachment {
  name: string;
  createTime: string;
  filename: string;
  type: string;
  size: string;
  memo?: string;
  externalLink?: string;
}

export interface Memo {
  name: string;
  content: string;
  visibility: MemoVisibility;
  tags: string[];
  pinned: boolean;
  state: MemoState;
  createTime: string;
  updateTime: string;
  creator: string;
  attachments: MemoAttachment[];
}

export interface CreateMemoRequest {
  content: string;
  visibility?: MemoVisibility;
  createTime?: string;
  updateTime?: string;
}

export interface UpdateMemoRequest {
  content?: string;
  visibility?: MemoVisibility;
  pinned?: boolean;
  state?: MemoState;
}

export interface CreateAttachmentRequest {
  filename: string;
  type: string;
  content?: string;
  memo?: string;
  externalLink?: string;
}

export interface SetMemoAttachmentsRequest {
  name: string;
  attachments: Array<Pick<MemoAttachment, 'name'> | CreateAttachmentRequest>;
}

export interface ListMemosResponse {
  memos: Memo[];
  nextPageToken?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  status: number;
  message: string;
}
