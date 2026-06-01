import assert from 'node:assert';
import { describe, it } from 'node:test';

import { computeSyncActions, hashContent } from './sync-engine';

describe('hashContent', () => {
  it('produces consistent output for same input', () => {
    assert.strictEqual(hashContent('hello'), hashContent('hello'));
  });

  it('produces different output for different input', () => {
    assert.notStrictEqual(hashContent('hello'), hashContent('world'));
  });
});

describe('computeSyncActions', () => {
  const syncTag = 'sp-sync';
  const localNote = (overrides = {}) => ({
    id: 'note-1',
    content: '# Same\nBody',
    createdAt: '2026-06-01T09:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    attachments: [],
    ...overrides,
  });
  const remoteMemo = (overrides = {}) => ({
    memoId: 'memo-1',
    content: '# Same\nBody',
    tags: [syncTag],
    createdAt: '2026-06-01T09:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    attachments: [],
    ...overrides,
  });

  it('creates memo for new local note with no mapping', () => {
    const actions = computeSyncActions({
      localNotes: [localNote({ content: '# Local\nBody' })],
      remoteMemos: [],
      mappingStore: { version: 1, mappings: [], lastFullSyncAt: null },
      syncTag,
    });

    assert.strictEqual(actions[0]?.type, 'create-memo');
  });

  it('imports remote memo as local note when no mapping exists', () => {
    const actions = computeSyncActions({
      localNotes: [],
      remoteMemos: [remoteMemo({ content: '# Remote\nBody' })],
      mappingStore: { version: 1, mappings: [], lastFullSyncAt: null },
      syncTag,
    });

    assert.strictEqual(actions[0]?.type, 'create-local-note');
  });

  it('updates remote memo when local note changed', () => {
    const lastSyncedContentHash = hashContent(JSON.stringify({ content: '# Same\nBody', attachments: [] }));
    const actions = computeSyncActions({
      localNotes: [localNote({ content: '# Changed\nBody', updatedAt: '2026-06-01T11:00:00.000Z' })],
      remoteMemos: [remoteMemo()],
      mappingStore: {
        version: 1,
        mappings: [{
          localNoteId: 'note-1',
          memoId: 'memo-1',
          syncTag,
          state: 'linked',
          lastSyncedAt: '2026-06-01T10:00:00.000Z',
          lastSyncedContentHash,
          lastKnownLocalUpdatedAt: '2026-06-01T10:00:00.000Z',
          lastKnownMemoUpdatedAt: '2026-06-01T10:00:00.000Z',
        }],
        lastFullSyncAt: null,
      },
      syncTag,
    });

    assert.strictEqual(actions[0]?.type, 'update-memo');
  });

  it('updates local note when remote memo changed', () => {
    const lastSyncedContentHash = hashContent(JSON.stringify({ content: '# Same\nBody', attachments: [] }));
    const actions = computeSyncActions({
      localNotes: [localNote()],
      remoteMemos: [remoteMemo({ content: '# Changed\nBody', updatedAt: '2026-06-01T11:00:00.000Z' })],
      mappingStore: {
        version: 1,
        mappings: [{
          localNoteId: 'note-1',
          memoId: 'memo-1',
          syncTag,
          state: 'linked',
          lastSyncedAt: '2026-06-01T10:00:00.000Z',
          lastSyncedContentHash,
          lastKnownLocalUpdatedAt: '2026-06-01T10:00:00.000Z',
          lastKnownMemoUpdatedAt: '2026-06-01T10:00:00.000Z',
        }],
        lastFullSyncAt: null,
      },
      syncTag,
    });

    assert.strictEqual(actions[0]?.type, 'update-local-note');
  });

  it('marks conflict when both sides changed', () => {
    const lastSyncedContentHash = hashContent(JSON.stringify({ content: '# Same\nBody', attachments: [] }));
    const actions = computeSyncActions({
      localNotes: [localNote({ content: '# Local\nBody', updatedAt: '2026-06-01T11:00:00.000Z' })],
      remoteMemos: [remoteMemo({ content: '# Remote\nBody', updatedAt: '2026-06-01T11:00:00.000Z' })],
      mappingStore: {
        version: 1,
        mappings: [{
          localNoteId: 'note-1',
          memoId: 'memo-1',
          syncTag,
          state: 'linked',
          lastSyncedAt: '2026-06-01T10:00:00.000Z',
          lastSyncedContentHash,
          lastKnownLocalUpdatedAt: '2026-06-01T10:00:00.000Z',
          lastKnownMemoUpdatedAt: '2026-06-01T10:00:00.000Z',
        }],
        lastFullSyncAt: null,
      },
      syncTag,
    });

    assert.strictEqual(actions[0]?.type, 'mark-conflict');
  });

  it('returns no-op when mapping is already synced', () => {
    const lastSyncedContentHash = hashContent(JSON.stringify({ content: '# Same\nBody', attachments: [] }));
    const actions = computeSyncActions({
      localNotes: [localNote()],
      remoteMemos: [remoteMemo()],
      mappingStore: {
        version: 1,
        mappings: [{
          localNoteId: 'note-1',
          memoId: 'memo-1',
          syncTag,
          state: 'linked',
          lastSyncedAt: '2026-06-01T10:00:00.000Z',
          lastSyncedContentHash,
          lastKnownLocalUpdatedAt: '2026-06-01T10:00:00.000Z',
          lastKnownMemoUpdatedAt: '2026-06-01T10:00:00.000Z',
        }],
        lastFullSyncAt: null,
      },
      syncTag,
    });

    assert.strictEqual(actions[0]?.type, 'no-op');
  });

  it('marks unlinked when remote memo disappears', () => {
    const actions = computeSyncActions({
      localNotes: [localNote()],
      remoteMemos: [],
      mappingStore: {
        version: 1,
        mappings: [{
          localNoteId: 'note-1',
          memoId: 'memo-1',
          syncTag,
          state: 'linked',
          lastSyncedAt: '2026-06-01T10:00:00.000Z',
          lastSyncedContentHash: hashContent(JSON.stringify({ content: '# Same\nBody', attachments: [] })),
          lastKnownLocalUpdatedAt: '2026-06-01T10:00:00.000Z',
          lastKnownMemoUpdatedAt: '2026-06-01T10:00:00.000Z',
        }],
        lastFullSyncAt: null,
      },
      syncTag,
    });

    assert.strictEqual(actions[0]?.type, 'mark-unlinked');
  });

  it('marks unlinked when local note disappears', () => {
    const actions = computeSyncActions({
      localNotes: [],
      remoteMemos: [remoteMemo()],
      mappingStore: {
        version: 1,
        mappings: [{
          localNoteId: 'note-1',
          memoId: 'memo-1',
          syncTag,
          state: 'linked',
          lastSyncedAt: '2026-06-01T10:00:00.000Z',
          lastSyncedContentHash: hashContent(JSON.stringify({ content: '# Same\nBody', attachments: [] })),
          lastKnownLocalUpdatedAt: '2026-06-01T10:00:00.000Z',
          lastKnownMemoUpdatedAt: '2026-06-01T10:00:00.000Z',
        }],
        lastFullSyncAt: null,
      },
      syncTag,
    });

    assert.strictEqual(actions[0]?.type, 'mark-unlinked');
  });
});
