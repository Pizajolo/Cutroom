// Projects are plain folders: raw/, references/, exports/, assets/ and a hidden .cutroom/.
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HOME, run } from '../cli/run';
import { PROJECT_DIRS } from '../shared/types';
import type { ImportDir, MediaFile, Project } from '../shared/types';

const RECENTS = path.join(HOME, 'recents.json');
const KINDS: [MediaFile['kind'], RegExp][] = [
  ['video', /\.(mp4|mov|m4v|mkv|webm|avi)$/i],
  ['audio', /\.(mp3|wav|m4a|aac|flac|ogg|aiff?)$/i],
  ['image', /\.(png|jpe?g|webp|gif|svg|heic)$/i],
];
const kindOf = (file: string): MediaFile['kind'] => KINDS.find(([, re]) => re.test(file))?.[0] ?? 'other';

/** Footage goes to raw/, everything else (logos, music, …) to assets/. */
const homeFor = (file: string): string => (kindOf(file) === 'video' ? 'raw' : 'assets');

/** Place a file in the project without ever overwriting: `name.mov`, `name-2.mov`, … */
async function place(root: string, source: string, move: boolean, dir = homeFor(source)): Promise<void> {
  const { name, ext } = path.parse(source);
  for (let n = 1; ; n++) {
    const target = path.join(root, dir, n === 1 ? name + ext : `${name}-${n}${ext}`);
    try {
      // Reserve the name first so neither copy nor rename can replace an existing file.
      await writeFile(target, '', { flag: 'wx' });
      await (move ? rename(source, target) : copyFile(source, target, constants.COPYFILE_FICLONE));
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

/** Open a folder as a project: create the standard folders and sort loose media into them. */
export async function openProject(root: string): Promise<Project> {
  for (const dir of [...PROJECT_DIRS, '.cutroom']) await mkdir(path.join(root, dir), { recursive: true });
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isFile() && !entry.name.startsWith('.') && kindOf(entry.name) !== 'other') {
      await place(root, path.join(root, entry.name), true);
    }
  }
  const project = { root, name: path.basename(root) };
  await mkdir(HOME, { recursive: true });
  const recents = [project, ...(await recentProjects()).filter((p) => p.root !== root)].slice(0, 30);
  await writeFile(RECENTS, JSON.stringify(recents, null, 2));
  return project;
}

export async function recentProjects(): Promise<Project[]> {
  try {
    return JSON.parse(await readFile(RECENTS, 'utf8')) as Project[];
  } catch {
    return [];
  }
}

/** Copy files into the project: into `dir`, or sorted by type when none is given. */
export async function importFiles(root: string, files: string[], dir?: ImportDir): Promise<void> {
  for (const file of files) await place(root, file, false, dir);
}

/** Download videos from links (TikTok, Instagram, YouTube, …) with yt-dlp. Returns what went wrong, per failed link. */
export async function downloadLinks(root: string, urls: string[], dir: ImportDir = 'references'): Promise<string[]> {
  const failures: string[] = [];
  for (const url of urls) {
    if (!/^https?:\/\//i.test(url)) {
      failures.push(`${url}: not a link`);
      continue;
    }
    // H.264 mp4 up to 1080p plays everywhere; names never collide (`uploader-id.mp4`).
    const args = ['--no-playlist', '--no-overwrites', '--restrict-filenames', '-S', 'res:1080,vcodec:h264,acodec:m4a'];
    await run('yt-dlp', [...args, '--merge-output-format', 'mp4', '-o', `${dir}/%(uploader,extractor)s-%(id)s.%(ext)s`, '--', url], { cwd: root }).catch(
      (error: Error) => failures.push(`${url}: ${error.message.match(/ERROR:.*/)?.[0] ?? error.message}`),
    );
  }
  return failures;
}

export async function listMedia(root: string): Promise<MediaFile[]> {
  const media: MediaFile[] = [];
  for (const dir of PROJECT_DIRS) {
    const names = await readdir(path.join(root, dir)).catch(() => []);
    for (const name of names.sort()) {
      if (!name.startsWith('.')) media.push({ path: `${dir}/${name}`, dir, kind: kindOf(name) });
    }
  }
  return media;
}

/** Remove a project from the recents list. Its folder is left untouched. */
export async function forgetProject(root: string): Promise<Project[]> {
  const recents = (await recentProjects()).filter((p) => p.root !== root);
  await writeFile(RECENTS, JSON.stringify(recents, null, 2));
  return recents;
}
