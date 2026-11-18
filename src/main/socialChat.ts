// The chat in Home › Social: Claude looks at exported videos, drafts captions and proposes posts, and can read the
// user's stats and competitors through the Social window (within the user's rules). It cannot post: only the
// user's Post button on a draft does that (socialPost.ts).
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { run } from '../cli/run';
import { WHISPER_MODEL } from '../cli/transcribe';
import type { AgentEvent, ChatMessage } from '../shared/types';
import { describeTool } from './agent';
import { brainConfig, features, loadSettings } from './settings';
import * as social from './social';
import { draftSummary, exportedVideos, proposeTool } from './socialPost';

const DIR = path.join(social.DIR, 'chat');
const CHAT = path.join(DIR, 'chat.json');
const SESSION = path.join(DIR, 'session');

const PROMPT = `

# Cutroom · Social

You are the social media assistant in Cutroom, a video editor for macOS. Here, outside any project, you help the user publish
videos they exported from Cutroom to TikTok and Instagram, and understand how their accounts and their competitors are doing.
Your working folder is scratch space: put frames and audio you extract there.

## Captions and posts
- Watch before you write. Get the length with ffprobe, pull a few frames and read them, e.g.
  \`ffmpeg -v error -i "<video>" -vf "fps=1/3,scale=480:-1" frames/<name>-%02d.jpg\` (more frames for short videos).
  If people talk, transcribe: \`ffmpeg -v error -i "<video>" -vn -ac 1 -ar 16000 audio.wav && whisper-cli -m "${WHISPER_MODEL}" -f audio.wav -np -nt\`.
- Write for the platform and in the language of the video, unless the user asks otherwise. TikTok: the first line is the
  hook, keep it short, 3–5 specific hashtags. Instagram: the first ~125 characters show before "more", line breaks are fine,
  a few specific hashtags (never more than 30). No hashtag spam, no engagement bait, nothing the video does not show.
- Read the project's ledger (<project>/.cutroom/ledger.json, if it exists): it lists where downloaded footage, music and
  generated media came from. Tell the user in the draft's note about anything they may not have the rights to post, and
  set ai_generated when the video has AI-generated picture or sound — the platforms require a label for that.
- Propose with propose_post: one draft per platform and video. The user sees it as a card, edits the caption if they like,
  and presses Post. You cannot post, schedule, edit or delete posts, and you never say something was posted unless the
  <drafts> list says so. To change a draft, propose a new one with \`replaces\`.
- Keep replies short. The card shows the caption, so don't repeat it in full; say what you went for and what to check.

## Stats and competitors
- Use the social tools when the user asks about their numbers, their competitors, or what works (if they are available).
  Open only what the question needs. Compare with saved counts (stats_history) to talk about growth.
- For which videos do well, start from video_stats (views per video, new views, totals, the Cutroom export each came
  from). Compare the top videos with the weak ones — hook, length, topic, posting time — and, when it helps, watch the
  exported files to say what the good ones share.`;

let turn: AbortController | undefined;
let working = false;
export const stop = (): void => turn?.abort();

export const load = async (): Promise<ChatMessage[]> => JSON.parse(await readFile(CHAT, 'utf8').catch(() => '[]')) as ChatMessage[];

/** Start over: a new conversation (drafts and posts stay). */
export async function reset(): Promise<void> {
  if (working) throw new Error('Wait until Claude has finished, or stop it.');
  await rm(CHAT, { force: true });
  await rm(SESSION, { force: true });
}

/** Where each picked video comes from, its length, and its project's ledger. */
async function describeVideos(videos: string[]): Promise<string> {
  if (!videos.length) return '';
  const known = await exportedVideos();
  const lines = await Promise.all(videos.map(async (file) => {
    const video = known.find((v) => v.path === file);
    if (!video) return `- ${file} (not an exported video of a recent project: it cannot be posted)`;
    const seconds = Number(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).catch(() => '')) || 0;
    const root = path.dirname(path.dirname(file));
    return `- ${file} — project “${video.project}” (${root}), ${seconds ? `${seconds.toFixed(1)} s` : 'length unknown'}, exported ${video.at.slice(0, 10)}; ledger: ${path.join(root, '.cutroom/ledger.json')}`;
  }));
  return `\n\n<videos note="The exported videos the user picked for this message.">\n${lines.join('\n')}\n</videos>`;
}

/** Send a message and stream the reply. The conversation is saved when the turn ends. */
export async function send(text: string, videos: string[], emit: (event: AgentEvent) => void): Promise<void> {
  if (working) throw new Error('Claude is still answering.');
  working = true;
  await mkdir(path.join(DIR, 'frames'), { recursive: true });
  const messages = await load();
  const reply: ChatMessage = { role: 'assistant', parts: [] };
  messages.push({ role: 'user', parts: [{ type: 'text', text }], files: videos }, reply);
  const forward = (event: AgentEvent): void => {
    const tail = reply.parts.at(-1);
    if (event.type === 'text' && tail?.type === 'text') tail.text += event.text;
    else if (event.type === 'text' || event.type === 'tool') reply.parts.push({ ...event });
    emit(event);
  };

  const settings = await loadSettings();
  const config = await brainConfig();
  // Reading TikTok and Instagram is the Social analytics feature; proposing posts is always there.
  const browse = !!(await features()).find((f) => f.id === 'social')?.active;
  const prompt = text + (await describeVideos(videos)) + (await draftSummary());
  let error: string | undefined;

  const attempt = async (resume?: string): Promise<boolean> => {
    const controller = (turn = new AbortController());
    let started = false;
    try {
      for await (const m of query({
        prompt,
        options: {
          cwd: DIR,
          ...(resume ? { resume } : {}),
          abortController: controller,
          env: config.env,
          model: config.model,
          mcpServers: { social: social.server(settings.social, { browse, extra: [proposeTool] }) },
          systemPrompt: { type: 'preset', preset: 'claude_code', append: PROMPT + (browse ? `\n${social.notes(settings.social)}` : '\n- The social tools for reading TikTok and Instagram are switched off.') },
          settingSources: [],
          permissionMode: 'acceptEdits',
          allowedTools: ['Bash', 'Read', 'Glob', 'Grep', 'TodoWrite', 'mcp__social'],
          disallowedTools: ['AskUserQuestion', 'WebSearch', 'WebFetch', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'],
          canUseTool: async () => ({ behavior: 'deny', message: 'Not available in the Social chat.' }),
          includePartialMessages: true,
        },
      })) {
        if (m.type === 'system' && m.subtype === 'init') {
          started = true;
          await writeFile(SESSION, m.session_id);
        }
        if ('parent_tool_use_id' in m && m.parent_tool_use_id) continue;
        if (m.type === 'stream_event' && m.event.type === 'content_block_delta' && m.event.delta.type === 'text_delta') {
          forward({ type: 'text', text: m.event.delta.text });
        } else if (m.type === 'assistant') {
          for (const block of m.message.content) {
            if (block.type === 'tool_use') forward({ type: 'tool', text: describeTool(block.name, block.input as Record<string, unknown>) });
          }
        } else if (m.type === 'result' && m.is_error) {
          error = 'result' in m ? m.result : `The assistant stopped early (${m.subtype}).`;
        }
      }
      return true;
    } catch (cause) {
      if (controller.signal.aborted) return true;
      // A session that can no longer be resumed should not brick the chat: start a fresh one.
      if (resume && !started) return false;
      error = (cause as Error).message;
      return true;
    }
  };

  try {
    const resume = await readFile(SESSION, 'utf8').catch(() => undefined);
    if (!(await attempt(resume))) {
      await rm(SESSION, { force: true });
      await attempt();
    }
  } finally {
    if (error) reply.parts.push({ type: 'text', text: error });
    reply.error = !!error;
    await writeFile(CHAT, JSON.stringify(messages)).catch(() => {});
    working = false;
    emit({ type: 'done', error });
  }
}
