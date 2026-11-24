import type { MappingStore, SyncMapping } from '../types';

export interface LocalNoteSnapshot {
  id: string;
  content: string;
  updatedAt: string;
  createdAt: string;
  state?: 'NORMAL' | 'ARCHIVED';
  pinned?: boolean;
  visibility?: 'PRIVATE' | 'PROTECTED' | 'PUBLIC' | 'SPACE';
  attachments: Array<{
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    remoteUrl?: string;
    remoteName?: string;
  }>;
}

export interface RemoteMemoSnapshot {
  memoId: string;
  content: string;
  tags: string[];
  updatedAt: string;
  createdAt: string;
  state?: 'NORMAL' | 'ARCHIVED';
  pinned?: boolean;
  visibility?: 'PRIVATE' | 'PROTECTED' | 'PUBLIC' | 'SPACE';
  attachments: Array<{
    name: string;
    filename: string;
    type: string;
    size: string;
  }>;
}

/**
 * Sync actions for plugin-owned notes.
 * - create-memo creates a new remote memo from a local note.
 * - create-local-note imports a remote memo into the local note store.
 * - update-memo pushes a changed local note to an existing remote memo.
 * - update-local-note pulls a changed remote memo into an existing local note.
 * - mark-conflict blocks automatic overwrite after changes on both sides.
 * - no-op means the linked pair is already in sync.
 * - mark-unlinked removes a broken or deleted mapping while preserving note content.
 */
export type SyncAction =
  | {
      type: 'create-memo';
      localNoteId: string;
      content: string;
      createdAt: string;
      localUpdatedAt: string;
      contentHash: string;
    }
  | {
      type: 'create-local-note';
      memoId: string;
      content: string;
      memoCreatedAt: string;
      memoUpdatedAt: string;
      contentHash: string;
    }
  | {
      type: 'update-memo';
      localNoteId: string;
      memoId: string;
      content: string;
      localUpdatedAt: string;
      contentHash: string;
      expectedRemoteHash: string;
      expectedLocalHash: string;
    }
  | {
      type: 'update-local-note';
      localNoteId: string;
      memoId: string;
      content: string;
      memoUpdatedAt: string;
      contentHash: string;
      expectedRemoteHash: string;
      expectedLocalHash: string;
    }
  | {
      type: 'mark-conflict';
      localNoteId: string;
      memoId: string;
      localContent: string;
      remoteContent: string;
      localHash: string;
      remoteHash: string;
    }
  | {
      type: 'no-op';
      localNoteId: string;
      memoId: string;
      snapshotHash?: string;
    }
  | {
      type: 'remote-missing';
      localNoteId: string;
      memoId: string;
    }
  | {
      type: 'mark-unlinked';
      localNoteId: string;
      memoId: string;
      reason: 'remote-deleted' | 'local-deleted';
    };

export interface ComputeSyncActionsParams {
  localNotes: LocalNoteSnapshot[];
  remoteMemos: RemoteMemoSnapshot[];
  mappingStore: MappingStore;
}

export function hashContent(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }

  let secondaryHash = 0;
  for (let i = 0; i < input.length; i++) {
    secondaryHash = (Math.imul(31, secondaryHash) + input.charCodeAt(i)) | 0;
  }

  const firstPart = (hash >>> 0).toString(16).padStart(8, '0');
  const secondPart = (secondaryHash >>> 0).toString(16).padStart(8, '0');
  const lengthPart = input.length.toString(16).padStart(8, '0');

  return `${firstPart}${secondPart}${lengthPart}`;
}

export function hashLocalSnapshot(note: LocalNoteSnapshot): string {
  return hashContent(JSON.stringify({
    content: note.content,
    state: note.state ?? 'NORMAL',
    pinned: note.pinned ?? false,
    visibility: note.visibility ?? 'PRIVATE',
    attachments: note.attachments.map((item) => ({
      name: item.remoteName || `local:${item.id}`,
      filename: item.filename,
      type: item.mimeType,
      size: Number(item.size),
    })).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

export function hashRemoteSnapshot(memo: RemoteMemoSnapshot): string {
  return hashContent(JSON.stringify({
    content: memo.content,
    state: memo.state ?? 'NORMAL',
    pinned: memo.pinned ?? false,
    visibility: memo.visibility ?? 'PRIVATE',
    attachments: memo.attachments.map((item) => ({
      name: item.name,
      filename: item.filename,
      type: item.type,
      size: Number(item.size),
    })).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

export function computeSyncActions(params: ComputeSyncActionsParams): SyncAction[] {
  const { localNotes, remoteMemos, mappingStore } = params;
  const actions: SyncAction[] = [];

  const mappingsByLocalNoteId = new Map<string, SyncMapping>();
  const mappingsByMemoId = new Map<string, SyncMapping>();
  for (const mapping of mappingStore.mappings) {
    mappingsByLocalNoteId.set(mapping.localNoteId, mapping);
    mappingsByMemoId.set(mapping.memoId, mapping);
  }

  const localNotesById = new Map<string, LocalNoteSnapshot>();
  for (const note of localNotes) {
    localNotesById.set(note.id, note);
  }

  const remoteMemosById = new Map<string, RemoteMemoSnapshot>();
  for (const memo of remoteMemos) {
    remoteMemosById.set(memo.memoId, memo);
  }

  const handledLocalNoteIds = new Set<string>();
  const handledMemoIds = new Set<string>();

  for (const localNote of localNotes) {
    const mapping = mappingsByLocalNoteId.get(localNote.id);

    if (!mapping) {
      actions.push({
        type: 'create-memo',
        localNoteId: localNote.id,
        content: localNote.content,
        createdAt: localNote.createdAt,
        localUpdatedAt: localNote.updatedAt,
        contentHash: hashContent(JSON.stringify({ content: localNote.content, attachments: localNote.attachments })),
      });
      handledLocalNoteIds.add(localNote.id);
      continue;
    }

    handledLocalNoteIds.add(localNote.id);
    handledMemoIds.add(mapping.memoId);

    const remoteMemo = remoteMemosById.get(mapping.memoId);
    if (!remoteMemo) {
      actions.push({
        type: 'remote-missing',
        localNoteId: localNote.id,
        memoId: mapping.memoId,
      });
      continue;
    }

    const localHash = hashLocalSnapshot(localNote);
    const remoteHash = hashRemoteSnapshot(remoteMemo);
    let localChanged: boolean;
    let remoteChanged: boolean;
    if (mapping.lastSyncedSnapshotHash) {
      localChanged = localHash !== mapping.lastSyncedSnapshotHash;
      remoteChanged = remoteHash !== mapping.lastSyncedSnapshotHash;
    } else {
      const oldLocalHash = hashContent(JSON.stringify({ content: localNote.content, attachments: localNote.attachments }));
      const oldRemoteHash = hashContent(JSON.stringify({ content: remoteMemo.content, attachments: remoteMemo.attachments }));
      localChanged = oldLocalHash !== mapping.lastSyncedContentHash;
      remoteChanged = oldRemoteHash !== mapping.lastSyncedContentHash;
      if (localHash === remoteHash) {
        localChanged = false;
        remoteChanged = false;
      } else if (!localChanged && !remoteChanged) {
        localChanged = localNote.updatedAt !== mapping.lastKnownLocalUpdatedAt;
        remoteChanged = remoteMemo.updatedAt !== mapping.lastKnownMemoUpdatedAt || !localChanged;
      }
    }

    if (mapping.state === 'conflict') {
      localChanged = true;
      remoteChanged = true;
    } else if (localHash === remoteHash) {
      localChanged = false;
      remoteChanged = false;
    }

    if (localChanged && remoteChanged) {
      actions.push({
        type: 'mark-conflict',
        localNoteId: localNote.id,
        memoId: mapping.memoId,
        localContent: localNote.content,
        remoteContent: remoteMemo.content,
        localHash,
        remoteHash,
      });
      continue;
    }

    if (localChanged) {
      actions.push({
        type: 'update-memo',
        localNoteId: localNote.id,
        memoId: mapping.memoId,
        content: localNote.content,
        localUpdatedAt: localNote.updatedAt,
        contentHash: localHash,
        expectedRemoteHash: remoteHash,
        expectedLocalHash: localHash,
      });
      continue;
    }

    if (remoteChanged) {
      actions.push({
        type: 'update-local-note',
        localNoteId: localNote.id,
        memoId: mapping.memoId,
        content: remoteMemo.content,
        memoUpdatedAt: remoteMemo.updatedAt,
        contentHash: remoteHash,
        expectedRemoteHash: remoteHash,
        expectedLocalHash: localHash,
      });
      continue;
    }

    actions.push({
      type: 'no-op',
      localNoteId: localNote.id,
      memoId: mapping.memoId,
      snapshotHash: localHash,
    });
  }

  for (const mapping of mappingStore.mappings) {
    if (handledLocalNoteIds.has(mapping.localNoteId)) {
      continue;
    }

    if (!localNotesById.has(mapping.localNoteId)) {
      actions.push({
        type: 'mark-unlinked',
        localNoteId: mapping.localNoteId,
        memoId: mapping.memoId,
        reason: 'local-deleted',
      });
      handledMemoIds.add(mapping.memoId);
    }
  }

  for (const remoteMemo of remoteMemos) {
    if (handledMemoIds.has(remoteMemo.memoId)) {
      continue;
    }

    if (mappingsByMemoId.has(remoteMemo.memoId)) {
      continue;
    }

    actions.push({
      type: 'create-local-note',
      memoId: remoteMemo.memoId,
      content: remoteMemo.content,
      memoCreatedAt: remoteMemo.createdAt,
      memoUpdatedAt: remoteMemo.updatedAt,
      contentHash: hashContent(JSON.stringify({ content: remoteMemo.content, attachments: remoteMemo.attachments })),
    });
  }

  return actions;
}
