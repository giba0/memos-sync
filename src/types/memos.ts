export type MemoVisibility = 'PRIVATE' | 'PROTECTED' | 'PUBLIC' | 'SPACE';
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

export interface MemoRelation {
  memo?: { name: string };
  relatedMemo?: { name: string };
  type: 'REFERENCE' | 'COMMENT';
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
  relations?: MemoRelation[];
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
  relations?: MemoRelation[];
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

export interface LinkMetadata {
  url: string;
  title: string;
  description: string;
  image: string;
}
