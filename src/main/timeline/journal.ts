import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { IpcFailure } from '@shared/ipc/errors';
import { managedPath } from '../fs/managed';

export function inspectJournal(bytes: Buffer): { lines: string[]; tail: Buffer } {
  const end = bytes.lastIndexOf(10) + 1;
  return { lines: bytes.subarray(0, end).toString('utf8').split('\n').filter(Boolean), tail: bytes.subarray(end) };
}
export function journalCompletion(tail: Buffer, pending: unknown): Buffer {
  const expected = Buffer.from(`${JSON.stringify(pending)}\n`);
  if (tail.length >= expected.length || !tail.equals(expected.subarray(0, tail.length))) throw new IpcFailure({ code: 'conflict', message: 'The journal tail does not match the pending edit. No recovery files were changed.' });
  return expected.subarray(tail.length);
}
// Complete only an exact byte prefix of the durable pending record, including partial UTF-8.
// Never truncate or rewrite a journal: a second crash can resume this append again.
export async function completeJournal(root: string, rel: string, original: Buffer, completion: Buffer): Promise<void> {
  const file = await open(await managedPath(root, rel), constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size !== original.length || !(await file.readFile()).equals(original)) throw new IpcFailure({ code: 'conflict', message: 'The journal changed during recovery. Reopen the project.' });
    await file.writeFile(completion); await file.sync();
  } finally { await file.close(); }
}
