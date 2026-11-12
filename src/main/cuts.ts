// Chats in a project. Each is a "cut": its own conversation and edit in `.cutroom/cuts/<id>/`, on the shared footage.
import { constants, existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { activeCut, addLedger, addVersion, patchProject, readCuts, readLedger, writeCuts } from '../cli/project';
import { cutFiles } from '../shared/types';
import type { ChatMessage, Cuts, Timeline } from '../shared/types';

/**
 * Left in a cut whose files came from somewhere else, until its next message tells Claude about it:
 * a cut split off another one, or (without `parent`) the edit of a project from before cuts existed.
 */
export interface Fork {
  /** Name of the cut it was split from. */
  parent?: string;
  /** Where its files were before. */
  parentDir: string;
  /** The parent's conversation continued after the split point, so the copied files may be ahead of this chat. */
  wentOn?: boolean;
  /** Claude's session to branch from, and the entry in it where this chat ends (omitted: all of it). */
  session?: string;
  at?: string;
  /** How the reply this chat ends with begins, when the branch point in the session is not known. */
  ends?: string;
}

/** What `.cutroom/` holds for every cut alike. Anything else in there belonged to the single edit of an older project. */
const SHARED = ['cuts', 'cuts.json', 'project.json', 'ledger.json', 'transcripts'];
const LEGACY_PATH = /\.cutroom\/(?!cuts\/|cuts\.json|project\.json|ledger\.json|transcripts\/)/g;
/** The files of a cut that name its other files. */
const INDEXES = ['script.md', 'selects.md', 'chat.json', 'versions.json', 'timeline.json'];
/** Not taken along by a split: the conversation and preview are the new cut's own. */
const OWN = ['session', 'fork.json', 'preview.mp4', 'chat.json', 'versions.json', 'marks'];

const read = (file: string): Promise<string | undefined> => readFile(file, 'utf8').catch(() => undefined);

/** Rewrite paths in a file, leaving it (and its modification time) alone when nothing changes. */
async function repoint(file: string, change: (text: string) => string): Promise<void> {
  const text = await read(file);
  if (text !== undefined && change(text) !== text) await writeFile(file, change(text));
}

export const listCuts = async (root: string): Promise<Cuts> => ({ cuts: await readCuts(root), active: await activeCut(root) });

/** Every project has at least one cut. A project from before cuts existed gets its edit moved into the first one. */
export async function ensureCuts(root: string): Promise<void> {
  if ((await readCuts(root)).length) return;
  const files = cutFiles('main');
  const dir = path.join(root, files.dir);
  await mkdir(dir, { recursive: true });
  const legacy = (await readdir(path.join(root, '.cutroom'))).filter((name) => !SHARED.includes(name) && !name.startsWith('.'));
  for (const name of legacy) await rename(path.join(root, '.cutroom', name), path.join(dir, name));
  const moved = (text: string): string => text.replace(LEGACY_PATH, `${files.dir}/`);
  // The timeline goes last, so a storyboard that was already carried out does not look newer than the edit.
  for (const name of INDEXES) await repoint(path.join(dir, name), moved);
  await repoint(path.join(root, '.cutroom/ledger.json'), moved);
  if (legacy.includes('session')) await writeFile(path.join(root, files.fork), JSON.stringify({ parentDir: '.cutroom' } satisfies Fork));
  await writeCuts(root, [{ id: 'main', name: 'Main' }]);
}

export async function setActive(root: string, id: string): Promise<Cuts> {
  await patchProject(root, { cut: id });
  return listCuts(root);
}

/** A folder name for a new cut: readable, and never one that is or was in use. */
function newId(root: string, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'chat';
  for (let n = 1; ; n++) {
    const id = n === 1 ? slug : `${slug}-${n}`;
    if (!existsSync(path.join(root, cutFiles(id).dir))) return id;
  }
}

/** A new, empty chat on the same footage. */
export async function newCut(root: string, name: string): Promise<Cuts> {
  const id = newId(root, name);
  await mkdir(path.join(root, cutFiles(id).dir), { recursive: true });
  await writeCuts(root, [...(await readCuts(root)), { id, name: name.trim() || 'Chat' }]);
  return setActive(root, id);
}

/**
 * Branch a cut after reply `message` of its chat: the new cut gets the conversation up to there, the edit as that
 * reply left it, and its own copy of the graphics and other files (as they are now).
 */
export async function splitCut(root: string, parentId: string, message: number, name: string): Promise<Cuts> {
  const cuts = await readCuts(root);
  const parent = cuts.find((c) => c.id === parentId);
  const from = cutFiles(parentId);
  const chat = JSON.parse((await read(path.join(root, from.chat))) ?? '[]') as ChatMessage[];
  const reply = chat[message];
  if (!parent || reply?.role !== 'assistant') throw new Error('Split from one of Claude’s replies.');
  const id = newId(root, name);
  const to = cutFiles(id);
  const [source, target] = [path.join(root, from.dir), path.join(root, to.dir)];
  const own = (text: string): string => text.replaceAll(`${from.dir}/`, `${to.dir}/`);

  // Clones on APFS, so even long graphics renders cost no time or space. Times are kept: the app compares them.
  await cp(source, target, {
    recursive: true, preserveTimestamps: true, mode: constants.COPYFILE_FICLONE,
    filter: (file) => !OWN.includes(path.relative(source, file)),
  });
  for (const file of ['script.md', 'selects.md']) await repoint(path.join(target, file), own);
  await writeFile(path.join(root, to.chat), own(JSON.stringify(chat.slice(0, message + 1))));

  // The edit as that reply left it: what the next step started from, or the edit as it is now.
  const next = chat.slice(message + 1).find((m) => m.before)?.before;
  const timeline = next ?? (JSON.parse((await read(path.join(root, from.timeline))) ?? 'null') as Timeline | null);
  if (timeline?.clips.length) {
    await writeFile(path.join(root, to.timeline), own(JSON.stringify(timeline, null, 2)));
    await addVersion(root, id, `Split from ${parent.name}`, JSON.parse(own(JSON.stringify(timeline))) as Timeline);
  } else {
    // Split before there was an edit: back to the storyboard.
    for (const file of [to.timeline, to.spokenCut]) await rm(path.join(root, file), { force: true });
  }
  for (const entry of await readLedger(root)) {
    if (entry.file.startsWith(`${from.dir}/`)) await addLedger(root, { ...entry, file: own(entry.file) });
  }

  // Claude continues from the same point: a branch of the parent's session (or of the one the parent itself branches from).
  const inherited = JSON.parse((await read(path.join(root, from.fork))) ?? 'null') as Fork | null;
  const session = (await read(path.join(root, from.session))) ?? inherited?.session;
  const wentOn = message < chat.length - 1;
  const ends = reply.parts.findLast((part) => part.type === 'text')?.text.slice(0, 200);
  const fork: Fork = { parent: parent.name, parentDir: from.dir, wentOn, session, at: reply.uuid, ends: wentOn && !reply.uuid ? ends : undefined };
  await writeFile(path.join(root, to.fork), JSON.stringify(fork));

  await writeCuts(root, [...cuts, { id, name: name.trim() || 'Chat', from: parentId }]);
  return setActive(root, id);
}

export async function renameCut(root: string, id: string, name: string): Promise<Cuts> {
  const cuts = await readCuts(root);
  if (name.trim()) await writeCuts(root, cuts.map((c) => (c.id === id ? { ...c, name: name.trim() } : c)));
  return listCuts(root);
}

/** Take a cut off the list (its folder is the caller's to remove) and open a neighbour if it was the one on screen. */
export async function dropCut(root: string, id: string): Promise<Cuts> {
  const cuts = await readCuts(root);
  const at = cuts.findIndex((c) => c.id === id);
  if (at < 0) return listCuts(root);
  if (cuts.length === 1) throw new Error('A project keeps at least one chat.');
  const active = await activeCut(root);
  await writeCuts(root, cuts.filter((c) => c.id !== id));
  return active === id ? setActive(root, (cuts[at - 1] ?? cuts[at + 1])!.id) : listCuts(root);
}
