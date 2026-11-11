// The brain: a Claude Agent SDK session working inside the project folder.
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { LIBRARY, readFavorites, styleVideos, useStyle } from '../cli/project';
import { run } from '../cli/run';
import { PREVIEW_FILE, UTILITY_SKILLS, clipLength, clipStarts } from '../shared/types';
import type { AgentEvent, AudioItem, Mark, Overlay, Skill, Timeline } from '../shared/types';
import { systemPrompt } from './prompt';
import { agentConfig } from './settings';

/** Built-in styles ship with the app; the user's own live in ~/.cutroom/library. Both are Claude Code plugins. */
const BUILTIN = path.resolve(import.meta.dirname, '../../skills');

const EXAMPLE = 'example.mp4';

export async function listSkills(): Promise<Skill[]> {
  await mkdir(path.join(LIBRARY, '.claude-plugin'), { recursive: true });
  await mkdir(path.join(LIBRARY, 'skills'), { recursive: true });
  await writeFile(path.join(LIBRARY, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'my', description: 'My Cutroom styles' }));
  const skills: Skill[] = [];
  const videos = await styleVideos();
  const favorites = await readFavorites();
  for (const [plugin, root] of [['cutroom', BUILTIN], ['my', LIBRARY]] as const) {
    for (const dir of await readdir(path.join(root, 'skills'))) {
      const text = await readFile(path.join(root, 'skills', dir, 'SKILL.md'), 'utf8').catch(() => '');
      const field = (key: string): string => new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(text)?.[1]?.trim() ?? '';
      if (!text) continue;
      const id = `${plugin}:${dir}`;
      const saved = path.join(root, 'skills', dir, EXAMPLE);
      const examples = [
        ...(plugin === 'my' && existsSync(saved) ? [{ file: saved, src: `media://style/${dir}/${EXAMPLE}`, label: 'Original — the style was saved from this' }] : []),
        // `…/trip/exports/trip-01.mp4` → "trip / trip-01.mp4"
        ...(videos[id] ?? []).map((file) => ({ file, src: `media://export${encodeURI(file)}`, label: `${file.split(path.sep).at(-3)} / ${path.basename(file)}` })),
      ];
      const tags = field('tags').split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean);
      skills.push({
        id, name: field('name') || dir, description: field('description'), custom: plugin === 'my',
        kind: field('kind') === 'move' ? 'move' : 'style', tags, favorite: favorites.includes(id), source: field('source') || undefined, examples,
      });
    }
  }
  return skills;
}

/** Folder of one of the user's own styles. Built-in styles are read-only. */
export function customSkillDir(id: string): string {
  const name = /^my:([\w-]+)$/.exec(id)?.[1];
  if (!name) throw new Error('Only your own styles can be changed.');
  return path.join(LIBRARY, 'skills', name);
}
export const skillFile = (id: string): string =>
  id.startsWith('my:') ? path.join(customSkillDir(id), 'SKILL.md') : path.join(BUILTIN, 'skills', id.replace(/^cutroom:/, ''), 'SKILL.md');

const seconds = (t: number): string => `${t.toFixed(2)}s`;

/** Turn the user's marks into text the agent can act on, with a screenshot of each marked moment. */
async function describeMarks(root: string, marks: Mark[], timeline: Timeline | null): Promise<string> {
  if (!timeline || marks.length === 0) return '';
  const starts = clipStarts(timeline);
  const lines: string[] = [];
  for (const [i, mark] of marks.entries()) {
    const end = mark.end ?? mark.start;
    const hit = (id: string, from: number, to: number): boolean =>
      mark.itemId ? mark.itemId === id : from <= end && to > mark.start;
    const timed = (kind: string, items: (Overlay | AudioItem)[]): string[] =>
      items
        .filter((o) => hit(o.id, o.at, o.at + (o.duration ?? Infinity)))
        .map((o) => `${kind} "${o.id}" (${o.label ?? o.src})`);
    const under = [
      ...timeline.clips.flatMap((c, n) => {
        const at = starts[n]!;
        if (!hit(c.id, at, at + clipLength(c))) return [];
        return `clip "${c.id}" (${c.src}, source ${seconds(c.in + Math.max(0, mark.start - at))})`;
      }),
      ...timed('overlay', timeline.overlays),
      ...timed('audio', timeline.audio),
    ];
    const shot = `.cutroom/marks/mark-${Date.now()}-${i}.jpg`;
    const preview = path.join(root, PREVIEW_FILE);
    let screenshot = '';
    if (existsSync(preview)) {
      await mkdir(path.join(root, '.cutroom/marks'), { recursive: true });
      await run('ffmpeg', ['-v', 'error', '-ss', String(mark.start), '-i', preview, '-frames:v', '1', '-q:v', '3', path.join(root, shot)])
        .then(() => (screenshot = ` — screenshot: ${shot}`))
        .catch(() => {});
    }
    const where = mark.end ? `${seconds(mark.start)}–${seconds(mark.end)}` : `frame at ${seconds(mark.start)}`;
    lines.push(`- ${where}: ${under.join(', ') || 'nothing on the timeline'}${screenshot}`);
  }
  return `\n\n<marks>\nThe user marked these parts of the edit (output-timeline times):\n${lines.join('\n')}\n</marks>`;
}

const describeTool = (name: string, input: Record<string, unknown>): string => {
  if (name === 'Bash') return String(input.description ?? input.command ?? 'Running a command').slice(0, 120);
  if (name.startsWith('mcp__')) return name.slice(5).replace(/__/, ': ').replace(/_/g, ' ');
  if (name === 'Skill') return `Using ${String(input.skill ?? '').replace(/^.*:/, '')}`;
  if (typeof input.file_path === 'string') return `${name} ${path.basename(input.file_path)}`;
  return name;
};

let turn: AbortController | undefined;
export const stop = (): void => turn?.abort();

/** Send one user message and stream the agent's reply as events. */
export async function send(root: string, text: string, marks: Mark[], files: string[], skills: string[], timeline: Timeline | null, emit: (event: AgentEvent) => void): Promise<void> {
  const config = await agentConfig(root);
  const sessionFile = path.join(root, '.cutroom/session');
  const resume = await readFile(sessionFile, 'utf8').catch(() => undefined);
  const footage = files.length ? `\n\n<footage>\nThe user selected this footage to use:\n${files.map((f) => `- ${f}`).join('\n')}\n</footage>` : '';
  // Styles and moves the user picked: a style shapes the whole video, a move goes where the message says.
  const picked = (await listSkills()).filter((s) => skills.includes(s.id));
  for (const skill of picked) await useStyle(root, skill.id);
  const techniques = picked.length
    ? `\n\n<techniques>\nThe user picked these from their library for this request. Load each with the Skill tool before working. ` +
      `A style shapes the whole video. A move is applied where the message says (the user refers to it as @name); if it doesn't say, where it fits best — and tell them where you used it.\n` +
      `${picked.map((s) => `- ${s.id} (${s.kind}, @${s.name})`).join('\n')}\n</techniques>`
    : '';
  const prompt = text + techniques + footage + (await describeMarks(root, marks, timeline));
  const controller = (turn = new AbortController());
  let error: string | undefined;
  let started = false;
  try {
    const messages = query({
      prompt,
      options: {
        cwd: root,
        resume,
        abortController: controller,
        env: config.env,
        model: config.model,
        mcpServers: config.mcpServers,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPrompt(LIBRARY) + config.notes },
        // Only Cutroom's own instructions and skills — not the user's personal Claude Code setup.
        settingSources: [],
        plugins: [{ type: 'local', path: BUILTIN }, { type: 'local', path: LIBRARY }],
        skills: 'all',
        additionalDirectories: [LIBRARY],
        // The agent edits by running FFmpeg & co., so shell and file tools run without prompts.
        permissionMode: 'acceptEdits',
        allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'TodoWrite', ...Object.keys(config.mcpServers).map((name) => `mcp__${name}`)],
        disallowedTools: ['AskUserQuestion', 'WebSearch', 'WebFetch'],
        // Style files count as sensitive, so Claude Code asks before writing them. Saving styles is the
        // point of the library: allow it there (and in the project), refuse it anywhere else.
        canUseTool: async (_tool, input) => {
          const file = path.resolve(root, String(input.file_path ?? ''));
          return [root, LIBRARY].some((dir) => file.startsWith(dir + path.sep))
            ? { behavior: 'allow', updatedInput: input }
            : { behavior: 'deny', message: 'Cutroom only allows this inside the project and the style library.' };
        },
        includePartialMessages: true,
      },
    });
    for await (const m of messages) {
      if (m.type === 'system' && m.subtype === 'init') {
        started = true;
        await writeFile(sessionFile, m.session_id);
      }
      if ('parent_tool_use_id' in m && m.parent_tool_use_id) continue;
      if (m.type === 'stream_event' && m.event.type === 'content_block_delta' && m.event.delta.type === 'text_delta') {
        emit({ type: 'text', text: m.event.delta.text });
      } else if (m.type === 'assistant') {
        for (const block of m.message.content) {
          // Remember which styles shaped this project, so its exports are listed under them.
          if (block.type === 'tool_use' && block.name === 'Skill') {
            const name = String((block.input as { skill?: string }).skill);
            const style = (await listSkills()).find((s) => s.id === name || s.id.endsWith(`:${name}`));
            if (style && !UTILITY_SKILLS.includes(style.id)) await useStyle(root, style.id);
          }
          if (block.type === 'tool_use') emit({ type: 'tool', text: describeTool(block.name, block.input as Record<string, unknown>) });
        }
      } else if (m.type === 'result' && m.is_error) {
        error = 'result' in m ? m.result : `The assistant stopped early (${m.subtype}).`;
      }
    }
  } catch (cause) {
    if (!controller.signal.aborted) {
      // A session that can no longer be resumed should not brick the project: start a fresh one.
      if (resume && !started) {
        await rm(sessionFile, { force: true });
        return send(root, text, marks, files, skills, timeline, emit);
      }
      error = (cause as Error).message;
    }
  }
  emit({ type: 'done', error });
}
