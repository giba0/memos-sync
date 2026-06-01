export type SyncState = 'linked' | 'dirty-local' | 'dirty-remote' | 'conflict' | 'unlinked';

export interface LocalAttachment {
  id: string;
  name: string;
  filename: string;
  mimeType: string;
  size: number;
  base64Content?: string;
  remoteUrl?: string;
  createdAt: string;
}

export interface LocalNote {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  attachments: LocalAttachment[];
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
