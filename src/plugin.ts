import { renderMarkdown, toggleChecklistLine } from './ui/markdown';
import { MemosClient } from './adapters/memos-client';
import { fetchRemoteMemosForSync } from './adapters/remote-memos';
import { deleteAttachments, loadAttachment, storeAttachments } from './adapters/local-attachments';
import { decodeState, encodeState } from './adapters/state-storage';
import { uploadAttachment } from './adapters/upload';
import { consumeEvents, eventsUnavailable } from './adapters/event-stream';
import { computeSyncActions, hashContent, hashLocalSnapshot, hashRemoteSnapshot } from './engine/sync-engine';
import type { LocalNoteSnapshot, RemoteMemoSnapshot, SyncAction } from './engine/sync-engine';
import type { LocalAttachment, LocalNote, MappingStore, PluginConfig, SyncLogEntry, SyncMapping, SyncResult } from './types';
import type { Memo, MemoAttachment, MemoRelation } from './types/memos';

declare const __MARKUP_DOCUMENT__: string;

declare const PluginAPI: {
  onReady(cb: () => void): void;
  persistDataSynced(data: string): void | Promise<void>;
  loadSyncedData(): Promise<string | null>;
  showSnack(config: {
    msg: string;
    type?: 'SUCCESS' | 'ERROR' | 'INFO' | 'WARNING';
  }): void;
  showIndexHtmlAsView(): void;
  registerShortcut(shortcut: {
    keys: string;
    label: string;
    action: () => void | Promise<void>;
    onExec?: () => void | Promise<void>;
  }): void;
};

interface PluginState {
  config: PluginConfig;
  notes: LocalNote[];
  selectedNoteId: string | null;
  composeRequestId: string | null;
  mappingStore: MappingStore;
  syncLog: SyncLogEntry[];
  deletedRemoteMemoIds: string[];
}

const DEFAULT_CONFIG: PluginConfig = {
  memosBaseUrl: '',
  memosApiToken: '',
  syncTag: 'memos-sync',
  autoSyncEnabled: false,
  pollIntervalMs: 300000,
};

const DEFAULT_MAPPING_STORE: MappingStore = {
  version: 1,
  mappings: [],
  lastFullSyncAt: null,
};

let state: PluginState = {
  config: { ...DEFAULT_CONFIG },
  notes: [],
  selectedNoteId: null,
  composeRequestId: null,
  mappingStore: { ...DEFAULT_MAPPING_STORE },
  syncLog: [],
  deletedRemoteMemoIds: [],
};

let autoSyncTimer: ReturnType<typeof setInterval> | null = null;
let isSyncRunning = false;
let stateRevision = 0;
let persistenceQueue: Promise<void> = Promise.resolve();
let stateReadError: Error | undefined;
let eventsController: AbortController | null = null;
let eventSyncTimer: ReturnType<typeof setTimeout> | null = null;
let eventPending = false;
let saveSyncPending = false;
let saveSyncTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSaveSync(): void {
  if (!state.config.memosBaseUrl || !state.config.memosApiToken) return;
  saveSyncPending = true;
  if (isSyncRunning || saveSyncTimer) return;
  saveSyncTimer = setTimeout(() => {
    saveSyncTimer = null;
    if (saveSyncPending && !isSyncRunning) void runSync('hook');
  }, 0);
}

function scheduleEventSync(): void {
  eventPending = true;
  if (eventSyncTimer) clearTimeout(eventSyncTimer);
  eventSyncTimer = setTimeout(() => {
    eventSyncTimer = null;
    if (isSyncRunning) return;
    eventPending = false;
    void runSync('auto');
  }, 1500);
}

function startEventStream(client: MemosClient, controller: AbortController): void {
  void (async () => {
    let connectedBefore = false;
    while (!controller.signal.aborted) {
      try {
        await consumeEvents(client, controller.signal, () => {
          if (connectedBefore) scheduleEventSync();
          connectedBefore = true;
        }, scheduleEventSync);
        if (!controller.signal.aborted) throw new Error('Memos event stream disconnected.');
      } catch (error) {
        if (controller.signal.aborted) return;
        if (eventsUnavailable(error)) {
          showSnack('Memos live updates unavailable; interval sync remains active.', 'WARNING');
          return;
        }
        console.warn('Memos event stream disconnected; interval sync remains active.', error);
      }
      await new Promise<void>((resolve) => {
        const done = (): void => {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', done);
          resolve();
        };
        const timer = setTimeout(done, 10000);
        controller.signal.addEventListener('abort', done, { once: true });
        if (controller.signal.aborted) done();
      });
    }
  })();
}

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${randomPart}`;
}

function createSyncResult(
  action: SyncResult['action'],
  detail: string,
  localNoteId = '',
  memoId = '',
): SyncResult {
  return {
    localNoteId,
    memoId,
    action,
    detail,
    timestamp: nowIso(),
  };
}

function showSnack(msg: string, type: 'SUCCESS' | 'ERROR' | 'INFO' | 'WARNING' = 'INFO'): void {
  PluginAPI.showSnack({ msg, type });
}

function appendSyncLog(results: SyncResult[], triggeredBy: 'manual' | 'auto' | 'hook'): void {
  const entry: SyncLogEntry = {
    id: createId('log'),
    timestamp: nowIso(),
    results,
    triggeredBy,
  };

  state.syncLog = [entry, ...state.syncLog.slice(0, 99)];
  saveState();
}

async function loadState(): Promise<void> {
  const raw = await PluginAPI.loadSyncedData();
  if (!raw) {
    return;
  }

  try {
    const parsed = JSON.parse(await decodeState(raw)) as Partial<PluginState>;
    state = {
      config: parsed.config ? {
        ...DEFAULT_CONFIG,
        ...parsed.config,
        syncTag: normalizeSyncTag(parsed.config.syncTag),
      } : { ...DEFAULT_CONFIG },
      notes: parsed.notes ?? [],
      selectedNoteId: null,
      composeRequestId: null,
      mappingStore: parsed.mappingStore ?? { ...DEFAULT_MAPPING_STORE },
      syncLog: parsed.syncLog ?? [],
      deletedRemoteMemoIds: parsed.deletedRemoteMemoIds ?? [],
    };
  } catch {
    stateReadError = new Error('Could not read the saved Memos Sync data. The existing data has been left intact.');
    throw stateReadError;
  }
}

function saveState(): Promise<void> {
  stateRevision++;
  const snapshot = JSON.stringify(state);
  const api = PluginAPI;
  const persisted = persistenceQueue.then(async () => {
    if (stateReadError) throw stateReadError;
    await api.persistDataSynced(await encodeState(snapshot));
  });
  persistenceQueue = persisted.catch(() => {
    api.showSnack({ msg: 'Memos Sync could not persist plugin data.', type: 'ERROR' });
  });
  return persisted;
}

function normalizePollIntervalMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_CONFIG.pollIntervalMs;
  }

  return Math.max(60_000, Math.round(value));
}

function normalizeSyncTag(value: string | undefined): string {
  return value?.trim().replace(/^#+/, '').trim() || DEFAULT_CONFIG.syncTag;
}

function stopAutoSync(): void {
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
  eventsController?.abort();
  eventsController = null;
  if (eventSyncTimer) clearTimeout(eventSyncTimer);
  eventSyncTimer = null;
  eventPending = false;
}

function restartAutoSync(): void {
  stopAutoSync();

  if (!state.config.autoSyncEnabled) {
    return;
  }

  if (!state.config.memosBaseUrl || !state.config.memosApiToken) {
    return;
  }

  const intervalMs = normalizePollIntervalMs(state.config.pollIntervalMs);
  state.config.pollIntervalMs = intervalMs;
  autoSyncTimer = setInterval(() => {
    void runSync('auto');
  }, intervalMs);
  const client = createClient();
  if (client && typeof AbortController !== 'undefined' && typeof ReadableStream !== 'undefined') {
    eventsController = new AbortController();
    startEventStream(client, eventsController);
  }
}

function setConfig(config: PluginConfig): void {
  state.config = {
    ...config,
    syncTag: normalizeSyncTag(config.syncTag),
    pollIntervalMs: normalizePollIntervalMs(config.pollIntervalMs),
  };
  saveState();
  restartAutoSync();
}

function createClient(configOverride?: PluginConfig): MemosClient | null {
  const config = configOverride ?? state.config;
  if (!config.memosBaseUrl || !config.memosApiToken) {
    return null;
  }

  return new MemosClient(config.memosBaseUrl, config.memosApiToken);
}

function deriveNoteTitle(content: string): string {
  const firstNonEmptyLine = content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return firstNonEmptyLine ? firstNonEmptyLine.slice(0, 60) : 'Untitled note';
}

function noteContentToMemoContent(content: string, legacyTag: string): string {
  if (!legacyTag) return content;
  const trimmed = content.trimEnd();
  const tag = `#${legacyTag.replace(/^#+/, '')}`;
  if (trimmed.includes(tag)) {
    return trimmed;
  }
  return trimmed.length > 0 ? `${trimmed}\n\n${tag}` : tag;
}

function memoContentToNoteContent(content: string, legacyTag: string): string {
  if (!legacyTag) return content;
  const tag = `#${legacyTag.replace(/^#+/, '')}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return content
    .replace(new RegExp(`(^|\\s)${tag}(?=\\s|$)`, 'g'), ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mapRemoteAttachmentToLocal(attachment: MemoAttachment, client: MemosClient): LocalAttachment {
  return {
    id: MemosClient.extractAttachmentId(attachment.name),
    name: attachment.name,
    filename: attachment.filename,
    mimeType: attachment.type,
    size: Number(attachment.size || 0),
    remoteUrl: client.buildAttachmentUrl(attachment.name, attachment.filename),
    createdAt: attachment.createTime,
  };
}

function attachmentSignature(attachments: Array<Pick<LocalAttachment, 'name' | 'filename' | 'mimeType' | 'size'>>): string {
  return JSON.stringify(
    attachments.map((attachment) => ({
      name: attachment.name,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
    })),
  );
}

async function assertDeviceAttachments(note: LocalNote): Promise<void> {
  for (const attachment of note.attachments) {
    if (attachment.devicePayload && await loadAttachment(attachment.id) === undefined) {
      throw new Error(`Attachment "${attachment.filename}" is pending on the device where it was added. Sync from that device.`);
    }
  }
}

async function syncNoteAttachments(note: LocalNote, remoteMemo: Memo, client: MemosClient): Promise<LocalAttachment[]> {
  const memoId = MemosClient.extractId(remoteMemo.name);
  const syncedAttachments: LocalAttachment[] = [];
  const attachmentRefs: Array<{ name: string }> = [];

  for (const attachment of note.attachments) {
    if (attachment.name) {
      syncedAttachments.push({ ...attachment });
      attachmentRefs.push({ name: attachment.name });
      continue;
    }

    const base64Content = attachment.devicePayload ? await loadAttachment(attachment.id) : attachment.base64Content;
    if (base64Content === undefined && (attachment.devicePayload || attachment.size !== 0)) {
      throw new Error(`Attachment "${attachment.filename}" has no content and cannot be uploaded.`);
    }

    const createdAttachment = await uploadAttachment(client, { ...attachment, base64Content }, (upload) => {
      const current = getLocalNote(note.id);
      if (!current) throw new Error('The note was removed while uploading an attachment.');
      upsertLocalNote({
        ...current,
        attachments: current.attachments.map((entry) => entry.id === attachment.id ? { ...entry, upload } : entry),
      });
      saveState();
    });

    const syncedAttachment: LocalAttachment = {
      ...attachment,
      id: MemosClient.extractAttachmentId(createdAttachment.name),
      name: createdAttachment.name,
      remoteUrl: client.buildAttachmentUrl(createdAttachment.name, createdAttachment.filename),
      createdAt: createdAttachment.createTime,
      size: Number(createdAttachment.size || attachment.size),
      base64Content: undefined,
      devicePayload: undefined,
      upload: undefined,
    };

    syncedAttachments.push(syncedAttachment);
    attachmentRefs.push({ name: createdAttachment.name });
    const currentNote = getLocalNote(note.id);
    if (currentNote) {
      upsertLocalNote({
        ...currentNote,
        attachments: currentNote.attachments.map((entry) => entry.id === attachment.id ? syncedAttachment : entry),
      });
      await saveState();
    }
    if (attachment.devicePayload) void deleteAttachments([attachment.id]).catch(() => {});
  }

  const existingNames = remoteMemo.attachments.map((attachment) => attachment.name).sort();
  const desiredNames = attachmentRefs.map((attachment) => attachment.name).sort();
  if (JSON.stringify(existingNames) !== JSON.stringify(desiredNames)) {
    await client.setMemoAttachments(memoId, attachmentRefs);
  }
  return syncedAttachments;
}

function outgoingReferences(memo: Memo): string[] {
  return [...new Set((memo.relations ?? [])
    .filter((relation) => relation.type === 'REFERENCE' && relation.memo?.name === memo.name)
    .flatMap((relation) => relation.relatedMemo?.name ? [relation.relatedMemo.name] : []))].sort();
}

async function changedReferences(
  note: LocalNote,
  memo: Memo,
  client: MemosClient,
): Promise<MemoRelation[] | undefined> {
  const current = outgoingReferences(memo);
  const desired = [...new Set(note.relatedMemoNames ?? [])].filter((name) => name !== memo.name).sort();
  if (JSON.stringify(current) === JSON.stringify(desired)) return undefined;
  // Memos replaces the outgoing reference set. Validate new targets before sending it.
  for (const name of desired) {
    if (!current.includes(name)) await client.getMemo(MemosClient.extractId(name));
  }
  return desired.map((name) => ({ type: 'REFERENCE', memo: { name: memo.name }, relatedMemo: { name } }));
}

function localSnapshot(note: LocalNote): LocalNoteSnapshot {
  return {
    id: note.id,
    content: note.content,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    state: note.state,
    pinned: note.pinned,
    visibility: note.visibility,
    relatedMemoNames: note.relatedMemoNames,
    attachments: note.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      remoteUrl: attachment.remoteUrl,
      remoteName: attachment.name,
    })),
  };
}

function remoteSnapshot(memo: Memo): RemoteMemoSnapshot {
  const mapping = state.mappingStore.mappings.find((item) => item.memoId === MemosClient.extractId(memo.name));
  return {
    memoId: MemosClient.extractId(memo.name),
    content: memoContentToNoteContent(memo.content, mapping?.syncTag ?? ''),
    tags: memo.tags,
    createdAt: memo.createTime,
    updatedAt: memo.updateTime,
    state: memo.state,
    pinned: memo.pinned,
    visibility: memo.visibility,
    relatedMemoNames: outgoingReferences(memo),
    attachments: memo.attachments,
  };
}

function mergeSyncedAttachments(note: LocalNote, attachments: LocalAttachment[]): void {
  const current = getLocalNote(note.id);
  if (!current) return;
  const replacements = new Map(note.attachments.map((attachment, index) => [attachment.id, attachments[index]]));
  upsertLocalNote({
    ...current,
    attachments: current.attachments.map((attachment) => replacements.get(attachment.id) ?? attachment),
  });
}

function upsertLocalNote(note: LocalNote): void {
  const index = state.notes.findIndex((entry) => entry.id === note.id);
  if (index >= 0) {
    state.notes[index] = note;
  } else {
    state.notes.unshift(note);
  }
}

function removeLocalNote(noteId: string): void {
  state.notes = state.notes.filter((note) => note.id !== noteId);
  if (state.selectedNoteId === noteId) {
    state.selectedNoteId = state.notes[0]?.id ?? null;
  }
}

function getLocalNote(noteId: string): LocalNote | undefined {
  return state.notes.find((note) => note.id === noteId);
}

function upsertMapping(mapping: SyncMapping): void {
  const index = state.mappingStore.mappings.findIndex(
    (entry) => entry.localNoteId === mapping.localNoteId && entry.memoId === mapping.memoId,
  );

  if (index >= 0) {
    state.mappingStore.mappings[index] = mapping;
  } else {
    state.mappingStore.mappings.push(mapping);
  }
}

function removeMapping(localNoteId: string, memoId: string): void {
  state.mappingStore.mappings = state.mappingStore.mappings.filter(
    (mapping) => !(mapping.localNoteId === localNoteId && mapping.memoId === memoId),
  );
}

function getMapping(localNoteId: string, memoId: string): SyncMapping | undefined {
  return state.mappingStore.mappings.find(
    (mapping) => mapping.localNoteId === localNoteId && mapping.memoId === memoId,
  );
}

function createLocalNote(content = ''): LocalNote {
  const timestamp = nowIso();
  const note: LocalNote = {
    id: createId('note'),
    content,
    createdAt: timestamp,
    updatedAt: timestamp,
    attachments: [],
  };

  upsertLocalNote(note);
  state.selectedNoteId = note.id;
  state.composeRequestId = null;
  saveState();
  return note;
}

function startNewNoteComposer(): void {
  state.selectedNoteId = null;
  state.composeRequestId = createId('compose');
  saveState();
}

function updateLocalNote(noteId: string, content: string): LocalNote | null {
  const existingNote = getLocalNote(noteId);
  if (!existingNote) {
    return null;
  }

    const updatedNote: LocalNote = {
      ...existingNote,
      content,
      updatedAt: nowIso(),
    };

  upsertLocalNote(updatedNote);
  saveState();
  return updatedNote;
}

function createLocalNoteFromRemote(
  content: string,
  memoCreatedAt: string,
  memoUpdatedAt: string,
  attachments: LocalAttachment[],
  memo: Memo,
): LocalNote {
  const note: LocalNote = {
    id: createId('note'),
    content,
    createdAt: memoCreatedAt,
    updatedAt: memoUpdatedAt,
    attachments,
    state: memo.state,
    pinned: memo.pinned,
    visibility: memo.visibility,
    relatedMemoNames: outgoingReferences(memo),
  };

  upsertLocalNote(note);
  return note;
}

function addAttachmentToNote(noteId: string, attachment: Omit<LocalAttachment, 'id' | 'createdAt'>): LocalNote | null {
  const note = getLocalNote(noteId);
  if (!note) {
    return null;
  }

  const updatedNote: LocalNote = {
    ...note,
    updatedAt: nowIso(),
    attachments: [
      ...note.attachments,
      {
        ...attachment,
        id: createId('attachment'),
        createdAt: nowIso(),
      },
    ],
  };

  upsertLocalNote(updatedNote);
  saveState();
  return updatedNote;
}

function removeAttachmentFromNote(noteId: string, attachmentId: string): LocalNote | null {
  const note = getLocalNote(noteId);
  if (!note) {
    return null;
  }

  const updatedNote: LocalNote = {
    ...note,
    updatedAt: nowIso(),
    attachments: note.attachments.filter((attachment) => attachment.id !== attachmentId),
  };

  upsertLocalNote(updatedNote);
  saveState();
  return updatedNote;
}

function assertMemoOwner(memo: Memo, currentUser: string): void {
  if (memo.creator !== currentUser) {
    throw new Error('The memo belongs to another Memos account; the operation was stopped.');
  }
}

async function executeAction(action: SyncAction, client: MemosClient, currentUser: string): Promise<SyncResult> {
  const timestamp = nowIso();

  try {
    switch (action.type) {
      case 'create-memo': {
        const noteBeforeCreate = getLocalNote(action.localNoteId);
        if (!noteBeforeCreate) throw new Error('Local note no longer exists.');
        await assertDeviceAttachments(noteBeforeCreate);
        if (noteBeforeCreate.visibility === 'SPACE') {
          throw new Error('Cannot create a SPACE memo without its space. Change visibility before syncing.');
        }
        let createdMemo = await client.createMemo({
          content: action.content,
          createTime: action.createdAt,
          ...(noteBeforeCreate?.visibility ? { visibility: noteBeforeCreate.visibility } : {}),
        });
        const memoId = MemosClient.extractId(createdMemo.name);
        const localNote = getLocalNote(action.localNoteId);
        upsertMapping({
          localNoteId: action.localNoteId,
          memoId,
          syncTag: '',
          state: 'linked',
          lastSyncedAt: timestamp,
          lastSyncedContentHash: action.contentHash,
          lastKnownLocalUpdatedAt: action.localUpdatedAt,
          lastKnownMemoUpdatedAt: createdMemo.updateTime,
          lastSyncedSnapshotHash: hashRemoteSnapshot(remoteSnapshot(createdMemo)),
        });
        saveState();
        if (localNote) {
          const relations = await changedReferences(localNote, createdMemo, client);
          if (localNote.state === 'ARCHIVED' || localNote.pinned || relations) {
            createdMemo = await client.updateMemo(memoId, {
              ...(localNote.state === 'ARCHIVED' ? { state: 'ARCHIVED' as const } : {}),
              ...(localNote.pinned ? { pinned: true } : {}),
              ...(relations ? { relations } : {}),
            });
            const mapping = getMapping(action.localNoteId, memoId);
            if (mapping) {
              upsertMapping({ ...mapping, lastSyncedSnapshotHash: hashRemoteSnapshot(remoteSnapshot(createdMemo)) });
              saveState();
            }
          }
          const syncedAttachments = await syncNoteAttachments(localNote, createdMemo, client);
          const updatedNote = { ...localNote, attachments: syncedAttachments };
          mergeSyncedAttachments(localNote, syncedAttachments);
          const mapping = getMapping(action.localNoteId, memoId);
          if (mapping) {
            upsertMapping({ ...mapping, lastSyncedSnapshotHash: hashLocalSnapshot(localSnapshot(updatedNote)) });
          }
        }
        return createSyncResult('created-remote', 'Created remote memo.', action.localNoteId, memoId);
      }

      case 'create-local-note': {
        const remoteMemo = await client.getMemo(action.memoId);
        assertMemoOwner(remoteMemo, currentUser);
        const localNote = createLocalNoteFromRemote(
          remoteMemo.content,
          remoteMemo.createTime,
          remoteMemo.updateTime,
          remoteMemo.attachments.map((attachment) => mapRemoteAttachmentToLocal(attachment, client)),
          remoteMemo,
        );
        upsertMapping({
          localNoteId: localNote.id,
          memoId: action.memoId,
          syncTag: '',
          state: 'linked',
          lastSyncedAt: timestamp,
          lastSyncedContentHash: action.contentHash,
          lastKnownLocalUpdatedAt: localNote.updatedAt,
          lastKnownMemoUpdatedAt: remoteMemo.updateTime,
          lastSyncedSnapshotHash: hashLocalSnapshot(localSnapshot(localNote)),
        });
        return createSyncResult('created-local', 'Imported remote memo as local note.', localNote.id, action.memoId);
      }

      case 'update-memo': {
        const localNote = getLocalNote(action.localNoteId);
        if (!localNote) {
          return createSyncResult('error', 'Local note not found.', action.localNoteId, action.memoId);
        }
        if (hashLocalSnapshot(localSnapshot(localNote)) !== action.expectedLocalHash) {
          throw new Error('Local note changed during sync. Run sync again to reconcile.');
        }
        await assertDeviceAttachments(localNote);
        const beforeUpdate = await client.getMemo(action.memoId);
        assertMemoOwner(beforeUpdate, currentUser);
        if (hashRemoteSnapshot(remoteSnapshot(beforeUpdate)) !== action.expectedRemoteHash) {
          throw new Error('Remote memo changed during sync. Run sync again to reconcile.');
        }
        if (localNote.visibility === 'SPACE' && beforeUpdate.visibility !== 'SPACE') {
          throw new Error('Cannot restore SPACE visibility without its space.');
        }
        const relations = await changedReferences(localNote, beforeUpdate, client);
        const latestNote = getLocalNote(action.localNoteId);
        if (!latestNote || hashLocalSnapshot(localSnapshot(latestNote)) !== action.expectedLocalHash) {
          throw new Error('Local note changed during sync. Run sync again to reconcile.');
        }
        const updatedMemo = await client.updateMemo(action.memoId, {
          content: noteContentToMemoContent(action.content, getMapping(action.localNoteId, action.memoId)?.syncTag ?? ''),
          ...(localNote.state && localNote.state !== beforeUpdate.state ? { state: localNote.state } : {}),
          ...(localNote.pinned !== undefined && localNote.pinned !== beforeUpdate.pinned ? { pinned: localNote.pinned } : {}),
          ...(localNote.visibility && localNote.visibility !== beforeUpdate.visibility ? { visibility: localNote.visibility } : {}),
          ...(relations ? { relations } : {}),
        });
        const syncedAttachments = await syncNoteAttachments(localNote, updatedMemo, client);
        const updatedNote = { ...localNote, attachments: syncedAttachments };
        mergeSyncedAttachments(localNote, syncedAttachments);
        upsertMapping({
          localNoteId: action.localNoteId,
          memoId: action.memoId,
          syncTag: getMapping(action.localNoteId, action.memoId)?.syncTag ?? '',
          state: 'linked',
          lastSyncedAt: timestamp,
          lastSyncedContentHash: action.contentHash,
          lastKnownLocalUpdatedAt: action.localUpdatedAt,
          lastKnownMemoUpdatedAt: updatedMemo.updateTime,
          lastSyncedSnapshotHash: hashLocalSnapshot(localSnapshot(updatedNote)),
        });
        return createSyncResult('updated-remote', 'Updated remote memo.', action.localNoteId, action.memoId);
      }

      case 'update-local-note': {
        const localNote = getLocalNote(action.localNoteId);
        if (!localNote) {
          return createSyncResult('error', 'Local note not found.', action.localNoteId, action.memoId);
        }
        if (hashLocalSnapshot(localSnapshot(localNote)) !== action.expectedLocalHash) {
          throw new Error('Local note changed during sync. Run sync again to reconcile.');
        }

        const remoteMemo = await client.getMemo(action.memoId);
        assertMemoOwner(remoteMemo, currentUser);
        if (hashRemoteSnapshot(remoteSnapshot(remoteMemo)) !== action.expectedRemoteHash) {
          throw new Error('Remote memo changed during sync. Run sync again to reconcile.');
        }
        const latestNote = getLocalNote(action.localNoteId);
        if (!latestNote || hashLocalSnapshot(localSnapshot(latestNote)) !== action.expectedLocalHash) {
          throw new Error('Local note changed during sync. Run sync again to reconcile.');
        }

        const updatedNote: LocalNote = {
          ...localNote,
          content: action.content,
          createdAt: remoteMemo.createTime,
          updatedAt: action.memoUpdatedAt,
          attachments: remoteMemo.attachments.map((attachment) => mapRemoteAttachmentToLocal(attachment, client)),
          state: remoteMemo.state,
          pinned: remoteMemo.pinned,
          visibility: remoteMemo.visibility,
          relatedMemoNames: outgoingReferences(remoteMemo),
        };
        upsertLocalNote(updatedNote);
        upsertMapping({
          localNoteId: action.localNoteId,
          memoId: action.memoId,
          syncTag: getMapping(action.localNoteId, action.memoId)?.syncTag ?? '',
          state: 'linked',
          lastSyncedAt: timestamp,
          lastSyncedContentHash: action.contentHash,
          lastKnownLocalUpdatedAt: action.memoUpdatedAt,
          lastKnownMemoUpdatedAt: action.memoUpdatedAt,
          lastSyncedSnapshotHash: hashLocalSnapshot(localSnapshot(updatedNote)),
        });
        return createSyncResult('updated-local', 'Updated local note from remote memo.', action.localNoteId, action.memoId);
      }

      case 'mark-conflict': {
        const existingMapping = getMapping(action.localNoteId, action.memoId);
        upsertMapping({
          ...existingMapping,
          localNoteId: action.localNoteId,
          memoId: action.memoId,
          syncTag: existingMapping?.syncTag ?? '',
          state: 'conflict',
          lastSyncedAt: existingMapping?.lastSyncedAt ?? timestamp,
          lastSyncedContentHash: existingMapping?.lastSyncedContentHash ?? '',
          lastKnownLocalUpdatedAt: existingMapping?.lastKnownLocalUpdatedAt ?? timestamp,
          lastKnownMemoUpdatedAt: existingMapping?.lastKnownMemoUpdatedAt ?? timestamp,
        });
        return createSyncResult('conflict', 'Conflict detected. Resolve manually.', action.localNoteId, action.memoId);
      }

      case 'mark-unlinked': {
        if (action.reason === 'remote-deleted') {
          removeLocalNote(action.localNoteId);
        }
        if (action.reason === 'local-deleted') {
          assertMemoOwner(await client.getMemo(action.memoId), currentUser);
          await client.softDelete(action.memoId);
        }
        removeMapping(action.localNoteId, action.memoId);
        return createSyncResult(
          'unlinked',
          action.reason === 'remote-deleted'
            ? 'Remote memo was deleted. Removed the local note and mapping.'
            : 'Local note was deleted. Removed the remote memo and mapping.',
          action.localNoteId,
          action.memoId,
        );
      }

      case 'remote-missing': {
        const mapping = getMapping(action.localNoteId, action.memoId);
        if (mapping) upsertMapping({ ...mapping, state: 'remote-missing' });
        return createSyncResult('error', 'Remote memo was not found or is inaccessible. Confirm deletion before removing the local note.', action.localNoteId, action.memoId);
      }

      case 'no-op':
        {
          const mapping = getMapping(action.localNoteId, action.memoId);
          if (mapping && action.snapshotHash) {
            upsertMapping({ ...mapping, state: 'linked', lastSyncedSnapshotHash: action.snapshotHash });
          }
        }
        return createSyncResult('no-op', 'Already in sync.', action.localNoteId, action.memoId);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    const localNoteId = 'localNoteId' in action ? action.localNoteId : '';
    const memoId = 'memoId' in action ? action.memoId : '';
    return createSyncResult('error', detail, localNoteId, memoId);
  }
}

async function runSync(triggeredBy: 'manual' | 'auto' | 'hook'): Promise<void> {
  if (isSyncRunning) {
    if (triggeredBy === 'manual') {
      showSnack('Memos Sync is already running.', 'INFO');
    }
    return;
  }

  isSyncRunning = true;
  saveSyncPending = false;
  const client = createClient();
  if (!client) {
    appendSyncLog([createSyncResult('error', 'Missing Memos URL or API token.')], triggeredBy);
    showSnack('Memos Sync: not configured. Open plugin settings.', 'ERROR');
    isSyncRunning = false;
    return;
  }

  try {
    const currentUser = await client.getCurrentUserName();
    const linkedMemoIds = new Set(state.mappingStore.mappings.map((mapping) => mapping.memoId));
    const remoteMemos = await fetchRemoteMemosForSync(
      client,
      state.mappingStore.mappings.map((mapping) => mapping.memoId),
    );

    const localNoteSnapshots = state.notes.map(localSnapshot);

    if (remoteMemos.some((memo) => typeof memo.creator !== 'string' || !/^users\/[^/]+$/.test(memo.creator))) {
      throw new Error('A Memos response did not identify its owner. Synchronization stopped to protect other users’ memos.');
    }
    if (remoteMemos.some((memo) => linkedMemoIds.has(MemosClient.extractId(memo.name)) && memo.creator !== currentUser)) {
      throw new Error('A linked memo belongs to another Memos account. Synchronization stopped to prevent changing another user’s notes.');
    }
    const remoteMemoSnapshots: RemoteMemoSnapshot[] = remoteMemos
      .filter((memo) => memo.creator === currentUser)
      .map(remoteSnapshot);

    const actions = computeSyncActions({
      localNotes: localNoteSnapshots,
      remoteMemos: remoteMemoSnapshots,
      mappingStore: state.mappingStore,
    });

    const results: SyncResult[] = [
      createSyncResult(
        'no-op',
        `Diagnostics: local notes=${state.notes.length}, remote memos=${remoteMemos.length}, computed actions=${actions.length}`,
      ),
    ];

    for (const action of actions) {
      results.push(await executeAction(action, client, currentUser));
    }

    state.mappingStore.lastFullSyncAt = nowIso();
    saveState();
    appendSyncLog(results, triggeredBy);

    const conflicts = results.filter((result) => result.action === 'conflict').length;
    const errors = results.filter((result) => result.action === 'error').length;
    const created = results.filter(
      (result) => result.action === 'created-local' || result.action === 'created-remote',
    ).length;

    if (conflicts > 0) {
      showSnack(`Memos Sync: ${conflicts} conflict(s) need resolution.`, 'WARNING');
      return;
    }

    if (errors > 0) {
      showSnack(`Memos Sync: completed with ${errors} error(s). Check Sync Log.`, 'ERROR');
      return;
    }

    if (triggeredBy !== 'hook') showSnack(`Memos Sync: completed with ${created} new sync action(s).`, 'SUCCESS');
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    appendSyncLog([createSyncResult('error', detail)], triggeredBy);
    showSnack(`Memos Sync error: ${detail}`, 'ERROR');
  } finally {
    isSyncRunning = false;
    if (saveSyncPending) scheduleSaveSync();
    if (eventPending && state.config.autoSyncEnabled && !eventSyncTimer) scheduleEventSync();
  }
}

PluginAPI.onReady(() => {
  void loadState().then(() => {
    restartAutoSync();
  }).catch((error) => showSnack(error.message, 'ERROR'));
  PluginAPI.registerShortcut({
    keys: 'ctrl+alt+m',
    label: 'Open Memos Sync',
    action: () => {
      PluginAPI.showIndexHtmlAsView();
    },
    onExec: () => {
      PluginAPI.showIndexHtmlAsView();
    },
  });
  PluginAPI.registerShortcut({
    keys: 'ctrl+alt+shift+n',
    label: 'Create Memos Sync Note',
    action: () => {
      startNewNoteComposer();
      PluginAPI.showIndexHtmlAsView();
    },
    onExec: () => {
      startNewNoteComposer();
      PluginAPI.showIndexHtmlAsView();
    },
  });
  PluginAPI.registerShortcut({
    keys: 'ctrl+alt+shift+s',
    label: 'Run Memos Sync',
    action: () => runSync('manual'),
    onExec: () => runSync('manual'),
  });
});

type ComposerAttachment = Omit<LocalAttachment, 'createdAt'>;
const composerDrafts = new Map<string, {
  text: string;
  visibility: LocalNote['visibility'];
  attachments: ComposerAttachment[];
  removed: string[];
  originalUpdatedAt?: string;
  relatedMemoNames?: string[];
  dirty: boolean;
}>();

(globalThis as Record<string, unknown>).__memosSyncPlugin = {
  renderMarkdown,
  toggleChecklistLine,
  getMarkupDocument: async () => {
    const compressed = Uint8Array.from(atob(__MARKUP_DOCUMENT__), (character) => character.charCodeAt(0));
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  },
  getComposerDrafts: () => composerDrafts,
  saveComposerNote: async (
    noteId: string | null,
    content: string,
    visibility: NonNullable<LocalNote['visibility']>,
    attachments: ComposerAttachment[],
    removed: string[],
    originalUpdatedAt?: string,
    relatedMemoNames?: string[],
  ) => {
    function currentNote() {
      const existing = noteId ? getLocalNote(noteId) ?? null : null;
      if (noteId && (!existing || existing.updatedAt !== originalUpdatedAt)) {
        throw new Error('This memo changed while you were editing. Copy your changes before discarding the draft.');
      }
      return existing;
    }
    currentNote();
    const timestamp = nowIso();
    const localAttachments = attachments.map((attachment) => ({
      ...attachment,
      id: createId('attachment'),
      createdAt: timestamp,
    }));
    await storeAttachments(localAttachments);
    const newIds = localAttachments.map((attachment) => attachment.id);
    let existing: LocalNote | null;
    try {
      existing = currentNote();
    } catch (error) {
      void deleteAttachments(newIds).catch(() => {});
      throw error;
    }
    const note: LocalNote = {
      ...existing,
      id: existing?.id ?? createId('note'),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      content,
      visibility,
      relatedMemoNames: relatedMemoNames ?? existing?.relatedMemoNames,
      attachments: [
        ...(existing?.attachments ?? []).filter((attachment) => !removed.includes(attachment.id)),
        ...localAttachments.map((attachment) => ({ ...attachment, base64Content: undefined, devicePayload: true })),
      ],
    };
    const previousSelection = state.selectedNoteId;
    const previousRequest = state.composeRequestId;
    upsertLocalNote(note);
    try {
      await saveState();
    } catch (error) {
      if (getLocalNote(note.id) === note) {
        if (existing) upsertLocalNote(existing);
        else state.notes = state.notes.filter((item) => item.id !== note.id);
        stateRevision++;
        void deleteAttachments(newIds).catch(() => {});
      }
      throw error;
    }
    if (state.selectedNoteId === previousSelection && state.composeRequestId === previousRequest) {
      state.selectedNoteId = null;
      state.composeRequestId = null;
      stateRevision++;
    }
    scheduleSaveSync();
    const removedPayloads = existing?.attachments.filter((item) => item.devicePayload && removed.includes(item.id)) ?? [];
    void deleteAttachments(removedPayloads.map((item) => item.id)).catch(() => {});
    return note;
  },
  getState: () => ({
    ...state,
    stateRevision,
    isSyncRunning,
    hasPendingChanges: state.notes.some((note) => {
      const mapping = state.mappingStore.mappings.find((entry) => entry.localNoteId === note.id);
      if (!mapping) return true;
      if (note.attachments.some((attachment) => !attachment.name)) return true;
      return mapping.lastSyncedSnapshotHash
        ? hashLocalSnapshot(localSnapshot(note)) !== mapping.lastSyncedSnapshotHash
        : note.updatedAt !== mapping.lastKnownLocalUpdatedAt;
    }) || state.deletedRemoteMemoIds.length > 0,
    noteSummaries: state.notes.map((note) => ({
      id: note.id,
      title: deriveNoteTitle(note.content),
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      preview: note.content.slice(0, 120),
      attachments: note.attachments,
      mapping: state.mappingStore.mappings.find((mapping) => mapping.localNoteId === note.id) ?? null,
    })),
  }),
  updateConfig: (config: PluginConfig) => {
    setConfig(config);
  },
  startNewNote: () => {
    startNewNoteComposer();
  },
  createNote: () => createLocalNote('# New note\n'),
  selectNote: (noteId: string) => {
    state.selectedNoteId = noteId;
    state.composeRequestId = null;
    saveState();
  },
  updateNote: (noteId: string, content: string) => updateLocalNote(noteId, content),
  updateNoteMetadata: (noteId: string, metadata: { state?: 'NORMAL' | 'ARCHIVED'; pinned?: boolean; visibility?: 'PRIVATE' | 'PROTECTED' | 'PUBLIC' }) => {
    const note = getLocalNote(noteId);
    if (!note) throw new Error('Local note not found.');
    upsertLocalNote({ ...note, ...metadata, updatedAt: nowIso() });
    saveState();
  },
  confirmRemoteDeletion: (localNoteId: string, memoId: string) => {
    const mapping = getMapping(localNoteId, memoId);
    if (!mapping || mapping.state !== 'remote-missing') {
      throw new Error('The remote memo is not awaiting deletion confirmation.');
    }
    removeLocalNote(localNoteId);
    removeMapping(localNoteId, memoId);
    saveState();
  },
  deleteNote: (noteId: string) => {
    removeLocalNote(noteId);
    saveState();
  },
  addAttachment: (noteId: string, attachment: Omit<LocalAttachment, 'id' | 'createdAt'>) =>
    addAttachmentToNote(noteId, attachment),
  removeAttachment: (noteId: string, attachmentId: string) =>
    removeAttachmentFromNote(noteId, attachmentId),
  readAttachment: async (noteId: string, attachmentId: string): Promise<Blob> => {
    const attachment = getLocalNote(noteId)?.attachments.find((entry) => entry.id === attachmentId);
    if (!attachment) throw new Error('Attachment not found.');
    const payload = attachment.devicePayload ? await loadAttachment(attachment.id) : attachment.base64Content;
    if (payload !== undefined) {
      const binary = atob(payload);
      return new Blob([Uint8Array.from(binary, (character) => character.charCodeAt(0))], { type: attachment.mimeType });
    }
    const client = createClient();
    if (!client || !attachment.name) throw new Error('Connect to Memos to open this attachment.');
    return client.downloadAttachment(attachment.name, attachment.filename);
  },
  getLinkMetadata: async (url: string) => {
    const client = createClient();
    if (!client) throw new Error('Connect to Memos to load link previews.');
    return client.getLinkMetadata(url);
  },
  runSync: (config?: PluginConfig) => {
    if (config) {
      setConfig(config);
    }
    return runSync('manual');
  },
  testConnection: async (config?: PluginConfig) => {
    const client = createClient(config);
    if (!client) {
      return {
        ok: false,
        status: 0,
        message: 'Missing Memos URL or API token.',
      };
    }

    return client.testConnection();
  },
  resolveConflict: async (localNoteId: string, memoId: string, winner: 'local' | 'remote') => {
    const client = createClient();
    if (!client) {
      return;
    }

    const mapping = getMapping(localNoteId, memoId);
    if (!mapping || mapping.state !== 'conflict') {
      return;
    }

    const timestamp = nowIso();
    const currentUser = await client.getCurrentUserName();
    if (winner === 'local') {
      const localNote = getLocalNote(localNoteId);
      if (!localNote) {
        return;
      }

      await assertDeviceAttachments(localNote);
      const currentMemo = await client.getMemo(memoId);
      assertMemoOwner(currentMemo, currentUser);
      if (localNote.visibility === 'SPACE' && currentMemo.visibility !== 'SPACE') {
        throw new Error('Cannot restore SPACE visibility without its space.');
      }
      const relations = await changedReferences(localNote, currentMemo, client);
      const updatedMemo = await client.updateMemo(memoId, {
        ...(relations ? { relations } : {}),
        content: noteContentToMemoContent(localNote.content, mapping.syncTag),
        state: localNote.state ?? 'NORMAL',
        pinned: localNote.pinned ?? false,
        ...(localNote.visibility && localNote.visibility !== 'SPACE' ? { visibility: localNote.visibility } : {}),
      });
      const syncedAttachments = await syncNoteAttachments(localNote, updatedMemo, client);
      const updatedNote = { ...localNote, attachments: syncedAttachments };
      upsertLocalNote(updatedNote);
      upsertMapping({
        localNoteId,
        memoId,
        syncTag: mapping.syncTag,
        state: 'linked',
        lastSyncedAt: timestamp,
        lastSyncedContentHash: hashContent(localNote.content),
        lastKnownLocalUpdatedAt: localNote.updatedAt,
        lastKnownMemoUpdatedAt: updatedMemo.updateTime,
        lastSyncedSnapshotHash: hashLocalSnapshot(localSnapshot(updatedNote)),
      });
    } else {
      const memo = await client.getMemo(memoId);
      assertMemoOwner(memo, currentUser);
      const localNote = getLocalNote(localNoteId);
      if (!localNote) {
        return;
      }

      const updatedNote: LocalNote = {
        ...localNote,
        content: memoContentToNoteContent(memo.content, mapping.syncTag),
        createdAt: memo.createTime,
        updatedAt: memo.updateTime,
        attachments: memo.attachments.map((attachment) => mapRemoteAttachmentToLocal(attachment, client)),
        state: memo.state,
        pinned: memo.pinned,
        visibility: memo.visibility,
        relatedMemoNames: outgoingReferences(memo),
      };
      upsertLocalNote(updatedNote);
      upsertMapping({
        localNoteId,
        memoId,
        syncTag: mapping.syncTag,
        state: 'linked',
        lastSyncedAt: timestamp,
        lastSyncedContentHash: hashContent(memoContentToNoteContent(memo.content, mapping.syncTag)),
        lastKnownLocalUpdatedAt: memo.updateTime,
        lastKnownMemoUpdatedAt: memo.updateTime,
        lastSyncedSnapshotHash: hashLocalSnapshot(localSnapshot(updatedNote)),
      });
    }

    saveState();
  },
  unlinkPair: (localNoteId: string, memoId: string) => {
    removeMapping(localNoteId, memoId);
    saveState();
  },
};
