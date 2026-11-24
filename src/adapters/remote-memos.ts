import { MemosApiError, MemosClient } from './memos-client';
import type { Memo } from '../types/memos';

export async function fetchRemoteMemosForSync(
  client: MemosClient,
  linkedMemoIds: string[],
): Promise<Memo[]> {
  const active = await client.listAllMemos();
  const archived = await client.listAllMemos('ARCHIVED');
  const byId = new Map([...active, ...archived].map((memo) => [MemosClient.extractId(memo.name), memo]));
  const memos = [...byId.values()];
  const seen = new Set(byId.keys());
  for (const memoId of new Set(linkedMemoIds)) {
    if (seen.has(memoId)) continue;
    try {
      const memo = await client.getMemo(memoId);
      memos.push(memo);
      seen.add(memoId);
    } catch (error) {
      if (error instanceof MemosApiError && error.status === 404) continue;
      throw error;
    }
  }
  return memos;
}
