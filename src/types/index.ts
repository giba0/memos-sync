export type SyncState = 'linked' | 'dirty-local' | 'dirty-remote' | 'conflict' | 'unlinked' | 'remote-missing';

export interface LocalAttachment {
  id: string;
  name: string;
  filename: string;
  mimeType: string;
  size: number;
  base64Content?: string;
  upload?: {
    attachmentId: string;
    uploadId?: string;
    legacyUncertain?: boolean;
    finalizing?: boolean;
    committedSize?: number;
  };
  remoteUrl?: string;
  createdAt: string;
}

export interface LocalNote {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  attachments: LocalAttachment[];
  state?: 'NORMAL' | 'ARCHIVED';
  pinned?: boolean;
  visibility?: 'PRIVATE' | 'PROTECTED' | 'PUBLIC' | 'SPACE';
}

export interface SyncMapping {
  localNoteId: string;
  memoId: string;
  syncTag: string;
  state: SyncState;
  lastSyncedAt: string;
  lastSyncedContentHash: string;
  lastKnownLocalUpdatedAt: string;
  lastKnownMemoUpdatedAt: string;
  lastSyncedSnapshotHash?: string;
}

export interface MappingStore {
  version: number;
  mappings: SyncMapping[];
  lastFullSyncAt: string | null;
}

export interface PluginConfig {
  memosBaseUrl: string;
  memosApiToken: string;
  syncTag: string;
  autoSyncEnabled: boolean;
  pollIntervalMs: number;
}

export interface SyncResult {
  localNoteId: string;
  memoId: string;
  action:
    | 'created-local'
    | 'created-remote'
    | 'updated-local'
    | 'updated-remote'
    | 'conflict'
    | 'no-op'
    | 'unlinked'
    | 'error';
  detail?: string;
  timestamp: string;
}

export interface SyncLogEntry {
  id: string;
  timestamp: string;
  results: SyncResult[];
  triggeredBy: 'manual' | 'auto' | 'hook';
}
