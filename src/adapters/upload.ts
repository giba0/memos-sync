import { MemosApiError, MemosClient } from './memos-client';
import type { LocalAttachment } from '../types';
import type { MemoAttachment } from '../types/memos';

type UploadState = NonNullable<LocalAttachment['upload']>;
type SaveProgress = (state: UploadState) => void;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return btoa(binary);
}

export async function uploadAttachment(
  client: MemosClient,
  attachment: LocalAttachment,
  save: SaveProgress,
): Promise<MemoAttachment> {
  if (!attachment.base64Content && attachment.size !== 0) throw new Error('Attachment content is missing.');
  const bytes = Uint8Array.from(atob(attachment.base64Content || ''), (character) => character.charCodeAt(0));
  if (bytes.length !== attachment.size) throw new Error('Attachment size does not match its saved content.');
  let state: UploadState = attachment.upload ?? { attachmentId: crypto.randomUUID().replace(/-/g, '') };
  const persist = (next: UploadState): void => { state = next; save(next); };
  if (state.legacyUncertain) {
    throw new Error(`The previous upload of "${attachment.filename}" may have succeeded. Check Memos before removing and reattaching it; it will not be retried automatically.`);
  }
  persist(state);

  if (state.finalizing) {
    try {
      const attachment = await client.getAttachment(state.attachmentId);
      if (attachment.name !== `attachments/${state.attachmentId}`) throw new Error('Memos returned an unexpected attachment.');
      return attachment;
    } catch (error) {
      if (!(error instanceof MemosApiError && error.status === 404)) throw error;
      if (!state.uploadId) throw new Error('The previous upload outcome is uncertain; check Memos before retrying.');
    }
  }

  let response;
  if (state.uploadId) {
    try {
      response = await client.uploadAttachmentPart({ uploadId: state.uploadId, writeOffset: '0' });
    } catch (error) {
      if (error instanceof MemosApiError && error.status === 404 && state.finalizing) {
        throw new Error(`The upload session for "${attachment.filename}" expired after finalization was attempted. Check Memos before removing and reattaching it.`);
      }
      if (!(error instanceof MemosApiError && error.status === 404)) {
        throw error;
      }
      persist({ attachmentId: state.attachmentId });
    }
  }

  if (!response) {
    try {
      response = await client.uploadAttachmentPart({
        spec: {
          attachment: { filename: attachment.filename, type: attachment.mimeType },
          attachmentId: state.attachmentId,
          totalSize: String(bytes.length),
        },
        writeOffset: '0',
      });
    } catch (error) {
      if (!(error instanceof MemosApiError && [404, 405, 501].includes(error.status))) throw error;
      persist({ ...state, legacyUncertain: true });
      return client.createAttachment({ filename: attachment.filename, type: attachment.mimeType, content: attachment.base64Content || '' });
    }
  }
  if (!response.uploadId || !Number.isSafeInteger(response.maxChunkSize) || response.maxChunkSize <= 0) {
    throw new Error('Invalid upload session response from Memos.');
  }
  persist({ ...state, uploadId: response.uploadId });
  for (;;) {
    if (response.attachment) {
      if (response.attachment.name !== `attachments/${state.attachmentId}`) throw new Error('Memos returned an unexpected attachment.');
      return response.attachment;
    }
    const offset = Number(response.committedSize || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > bytes.length) throw new Error('Invalid upload offset returned by Memos.');
    persist({ ...state, committedSize: offset });
    const end = Math.min(offset + response.maxChunkSize, bytes.length);
    const finish = end === bytes.length;
    if (finish) persist({ ...state, finalizing: true });
    const next = await client.uploadAttachmentPart({
      uploadId: state.uploadId,
      writeOffset: String(offset),
      data: bytesToBase64(bytes.subarray(offset, end)),
      finishWrite: finish,
    });
    if (!next.attachment && Number(next.committedSize || 0) <= offset && end > offset) {
      throw new Error('Memos did not advance the upload.');
    }
    if (finish && !next.attachment) throw new Error('Memos did not confirm the finished attachment.');
    response = next;
  }
}
