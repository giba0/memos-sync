import { MemosClient } from './adapters/memos-client';
import { computeSyncActions, hashContent } from './engine/sync-engine';
import type { LocalNoteSnapshot, RemoteMemoSnapshot, SyncAction } from './engine/sync-engine';
import type { LocalAttachment, LocalNote, MappingStore, PluginConfig, SyncLogEntry, SyncMapping, SyncResult } from './types';
import type { MemoAttachment } from './types/memos';

declare const PluginAPI: {
  onReady(cb: () => void): void;
  persistDataSynced(data: string): void;
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
    const parsed = JSON.parse(raw) as Partial<PluginState>;
    state = {
      config: parsed.config ?? { ...DEFAULT_CONFIG },
      notes: parsed.notes ?? [],
      selectedNoteId: parsed.selectedNoteId ?? null,
      composeRequestId: parsed.composeRequestId ?? null,
      mappingStore: parsed.mappingStore ?? { ...DEFAULT_MAPPING_STORE },
      syncLog: parsed.syncLog ?? [],
      deletedRemoteMemoIds: parsed.deletedRemoteMemoIds ?? [],
    };
  } catch {
    state = {
      config: { ...DEFAULT_CONFIG },
      notes: [],
      selectedNoteId: null,
      composeRequestId: null,
      mappingStore: { ...DEFAULT_MAPPING_STORE },
      syncLog: [],
      deletedRemoteMemoIds: [],
    };
  }
}

function saveState(): void {
  PluginAPI.persistDataSynced(JSON.stringify(state));
}

function normalizePollIntervalMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_CONFIG.pollIntervalMs;
  }

  return Math.max(60_000, Math.round(value));
}

function stopAutoSync(): void {
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
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
}

function setConfig(config: PluginConfig): void {
  state.config = {
    ...config,
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

function syncTagToken(): string {
  return state.config.syncTag.startsWith('#') ? state.config.syncTag : `#${state.config.syncTag}`;
}

function noteContentToMemoContent(content: string): string {
  const trimmed = content.trimEnd();
  const tag = syncTagToken();
  if (trimmed.includes(tag)) {
    return trimmed;
  }
  return trimmed.length > 0 ? `${trimmed}\n\n${tag}` : tag;
}

function memoContentToNoteContent(content: string): string {
  const tag = syncTagToken().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

async function syncNoteAttachments(note: LocalNote, memoId: string, client: MemosClient): Promise<LocalAttachment[]> {
  if (note.attachments.length === 0) {
    return [];
  }

  const syncedAttachments: LocalAttachment[] = [];
  const attachmentRefs: Array<{ name: string }> = [];

  for (const attachment of note.attachments) {
    if (attachment.name) {
      syncedAttachments.push({ ...attachment });
      attachmentRefs.push({ name: attachment.name });
      continue;
    }

    if (!attachment.base64Content) {
      syncedAttachments.push({ ...attachment });
      continue;
    }

    const createdAttachment = await client.createAttachment({
      filename: attachment.filename,
      type: attachment.mimeType,
      content: attachment.base64Content,
    });

    const syncedAttachment: LocalAttachment = {
      ...attachment,
      id: MemosClient.extractAttachmentId(createdAttachment.name),
      name: createdAttachment.name,
      remoteUrl: client.buildAttachmentUrl(createdAttachment.name, createdAttachment.filename),
      createdAt: createdAttachment.createTime,
      size: Number(createdAttachment.size || attachment.size),
      base64Content: undefined,
    };

    syncedAttachments.push(syncedAttachment);
    attachmentRefs.push({ name: createdAttachment.name });
  }

  if (attachmentRefs.length > 0) {
    await client.setMemoAttachments(memoId, attachmentRefs);
  }
  return syncedAttachments;
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
): LocalNote {
  const note: LocalNote = {
    id: createId('note'),
    content,
    createdAt: memoCreatedAt,
    updatedAt: memoUpdatedAt,
    attachments,
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

async function executeAction(action: SyncAction, client: MemosClient): Promise<SyncResult> {
  const timestamp = nowIso();

  try {
    switch (action.type) {
      case 'create-memo': {
        const createdMemo = await client.createMemo({
          content: noteContentToMemoContent(action.content),
          createTime: action.createdAt,
        });
        const memoId = MemosClient.extractId(createdMemo.name);
        const localNote = getLocalNote(action.localNoteId);
        const syncedAttachments = localNote
          ? await syncNoteAttachments(localNote, memoId, client)
          : [];
        if (localNote) {
          upsertLocalNote({ ...localNote, attachments: syncedAttachments });
        }
        upsertMapping({
          localNoteId: action.localNoteId,
          memoId,
          syncTag: state.config.syncTag,
          state: 'linked',
          lastSyncedAt: timestamp,
          lastSyncedContentHash: action.contentHash,
          lastKnownLocalUpdatedAt: action.localUpdatedAt,
          lastKnownMemoUpdatedAt: createdMemo.updateTime,
        });
        return createSyncResult('created-remote', 'Created remote memo.', action.localNoteId, memoId);
      }

      case 'create-local-note': {
        const remoteMemo = await client.getMemo(action.memoId);
        const localNote = createLocalNoteFromRemote(
          action.content,
          action.memoCreatedAt,
          action.memoUpdatedAt,
          remoteMemo.attachments.map((attachment) => mapRemoteAttachmentToLocal(attachment, client)),
        );
        upsertMapping({
          localNoteId: localNote.id,
          memoId: action.memoId,
          syncTag: state.config.syncTag,
          state: 'linked',
          lastSyncedAt: timestamp,
          lastSyncedContentHash: action.contentHash,
          lastKnownLocalUpdatedAt: localNote.updatedAt,
          lastKnownMemoUpdatedAt: action.memoUpdatedAt,
        });
        return createSyncResult('created-local', 'Imported remote memo as local note.', localNote.id, action.memoId);
      }

      case 'update-memo': {
        const updatedMemo = await client.updateMemo(action.memoId, {
          content: noteContentToMemoContent(action.content),
        });
        const localNote = getLocalNote(action.localNoteId);
        const syncedAttachments = localNote
          ? await syncNoteAttachments(localNote, action.memoId, client)
          : [];
        if (localNote) {
          upsertLocalNote({ ...localNote, attachments: syncedAttachments });
        }
        upsertMapping({
          localNoteId: action.localNoteId,
          memoId: action.memoId,
          syncTag: state.config.syncTag,
          state: 'linked',
          lastSyncedAt: timestamp,
          lastSyncedContentHash: action.contentHash,
          lastKnownLocalUpdatedAt: action.localUpdatedAt,
          lastKnownMemoUpdatedAt: updatedMemo.updateTime,
        });
        return createSyncResult('updated-remote', 'Updated remote memo.', action.localNoteId, action.memoId);
      }

      case 'update-local-note': {
        const localNote = getLocalNote(action.localNoteId);
        if (!localNote) {
          return createSyncResult('error', 'Local note not found.', action.localNoteId, action.memoId);
        }

        const remoteMemo = await client.getMemo(action.memoId);

        const updatedNote: LocalNote = {
          ...localNote,
          content: action.content,
          createdAt: remoteMemo.createTime,
          updatedAt: action.memoUpdatedAt,
          attachments: remoteMemo.attachments.map((attachment) => mapRemoteAttachmentToLocal(attachment, client)),
        };
        upsertLocalNote(updatedNote);
        upsertMapping({
          localNoteId: action.localNoteId,
          memoId: action.memoId,
          syncTag: state.config.syncTag,
          state: 'linked',
          lastSyncedAt: timestamp,
          lastSyncedContentHash: action.contentHash,
          lastKnownLocalUpdatedAt: action.memoUpdatedAt,
          lastKnownMemoUpdatedAt: action.memoUpdatedAt,
        });
        return createSyncResult('updated-local', 'Updated local note from remote memo.', action.localNoteId, action.memoId);
      }

      case 'mark-conflict': {
        const existingMapping = getMapping(action.localNoteId, action.memoId);
        upsertMapping({
          localNoteId: action.localNoteId,
          memoId: action.memoId,
          syncTag: state.config.syncTag,
          state: 'conflict',
          lastSyncedAt: existingMapping?.lastSyncedAt ?? timestamp,
          lastSyncedContentHash: existingMapping?.lastSyncedContentHash ?? '',
          lastKnownLocalUpdatedAt: timestamp,
          lastKnownMemoUpdatedAt: timestamp,
        });
        return createSyncResult('conflict', 'Conflict detected. Resolve manually.', action.localNoteId, action.memoId);
      }

      case 'mark-unlinked': {
        if (action.reason === 'remote-deleted') {
          removeLocalNote(action.localNoteId);
        }
        if (action.reason === 'local-deleted') {
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

      case 'no-op':
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
  const client = createClient();
  if (!client) {
    appendSyncLog([createSyncResult('error', 'Missing Memos URL or API token.')], triggeredBy);
    showSnack('Memos Sync: not configured. Open plugin settings.', 'ERROR');
    isSyncRunning = false;
    return;
  }

  try {
    const remoteMemosResponse = await client.listMemos({
      pageSize: 1000,
    });

    const localNoteSnapshots: LocalNoteSnapshot[] = state.notes.map((note) => ({
      id: note.id,
      content: note.content,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      attachments: note.attachments.map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size,
        remoteUrl: attachment.remoteUrl,
        remoteName: attachment.name,
      })),
    }));

    const remoteMemoSnapshots: RemoteMemoSnapshot[] = remoteMemosResponse.memos
      .filter((memo) => memo.tags.includes(state.config.syncTag))
      .map((memo) => ({
        memoId: MemosClient.extractId(memo.name),
        content: memoContentToNoteContent(memo.content),
        tags: memo.tags,
        createdAt: memo.createTime,
        updatedAt: memo.updateTime,
        attachments: memo.attachments,
      }));

    const actions = computeSyncActions({
      localNotes: localNoteSnapshots,
      remoteMemos: remoteMemoSnapshots,
      mappingStore: state.mappingStore,
      syncTag: state.config.syncTag,
    });

    const results: SyncResult[] = [
      createSyncResult(
        'no-op',
        `Diagnostics: local notes=${state.notes.length}, remote memos=${remoteMemosResponse.memos.length}, computed actions=${actions.length}`,
      ),
    ];

    for (const action of actions) {
      results.push(await executeAction(action, client));
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

    showSnack(`Memos Sync: completed with ${created} new sync action(s).`, 'SUCCESS');
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    appendSyncLog([createSyncResult('error', detail)], triggeredBy);
    showSnack(`Memos Sync error: ${detail}`, 'ERROR');
  } finally {
    isSyncRunning = false;
  }
}

PluginAPI.onReady(() => {
  void loadState().then(() => {
    restartAutoSync();
  });
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

(globalThis as Record<string, unknown>).__memosSyncPlugin = {
  getState: () => ({
    ...state,
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
  deleteNote: (noteId: string) => {
    removeLocalNote(noteId);
    saveState();
  },
  addAttachment: (noteId: string, attachment: Omit<LocalAttachment, 'id' | 'createdAt'>) =>
    addAttachmentToNote(noteId, attachment),
  removeAttachment: (noteId: string, attachmentId: string) =>
    removeAttachmentFromNote(noteId, attachmentId),
  runSync: (config?: PluginConfig) => {
    if (config) {
      setConfig(config);
    }
    return runSync('manual');
  },
  testConnection: async (config?: PluginConfig) => {
    if (config) {
      setConfig(config);
    }

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
    if (winner === 'local') {
      const localNote = getLocalNote(localNoteId);
      if (!localNote) {
        return;
      }

      const updatedMemo = await client.updateMemo(memoId, {
        content: noteContentToMemoContent(localNote.content),
      });
      const syncedAttachments = await syncNoteAttachments(localNote, memoId, client);
      upsertLocalNote({ ...localNote, attachments: syncedAttachments });
      upsertMapping({
        localNoteId,
        memoId,
        syncTag: state.config.syncTag,
        state: 'linked',
        lastSyncedAt: timestamp,
        lastSyncedContentHash: hashContent(localNote.content),
        lastKnownLocalUpdatedAt: localNote.updatedAt,
        lastKnownMemoUpdatedAt: updatedMemo.updateTime,
      });
    } else {
      const memo = await client.getMemo(memoId);
      const localNote = getLocalNote(localNoteId);
      if (!localNote) {
        return;
      }

      upsertLocalNote({
        ...localNote,
        content: memoContentToNoteContent(memo.content),
        createdAt: memo.createTime,
        updatedAt: memo.updateTime,
        attachments: memo.attachments.map((attachment) => mapRemoteAttachmentToLocal(attachment, client)),
      });
      upsertMapping({
        localNoteId,
        memoId,
        syncTag: state.config.syncTag,
        state: 'linked',
        lastSyncedAt: timestamp,
        lastSyncedContentHash: hashContent(memoContentToNoteContent(memo.content)),
        lastKnownLocalUpdatedAt: memo.updateTime,
        lastKnownMemoUpdatedAt: memo.updateTime,
      });
    }

    saveState();
  },
  unlinkPair: (localNoteId: string, memoId: string) => {
    removeMapping(localNoteId, memoId);
    saveState();
  },
};
