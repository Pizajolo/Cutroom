// One Claude conversation kept in a folder (chat.json and the session id): the brand kit chat and the logo studio.
// A turn streams its text and steps, continues the earlier session, and is saved when it ends.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { CanUseTool, McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, ChatMessage } from '../shared/types';
import { brainConfig } from './settings';

export interface Turn {
  /** What the user wrote, as shown in the chat. */
  text: string;
  /** What Claude gets: the text plus context (attachments, the kit as it is now, …). */
  prompt: string;
  /** Names shown as attachment chips on the user's message. */
  files?: string[];
  systemPrompt: string;
  mcpServers: Record<string, McpServerConfig>;
  allowedTools: string[];
  disallowedTools: string[];
  canUseTool: CanUseTool;
  /** One step of Claude's as the user reads it; '' hides it. */
  describe: (tool: string, input: Record<string, unknown>) => string;
  emit: (event: AgentEvent) => void;
}

export class ChatRunner {
  private turn: AbortController | undefined;
  private working = false;

  /** `dir(id)`: the folder of conversation `id`. */
  constructor(private readonly dir: (id: string) => string) {}

  load = async (id: string): Promise<ChatMessage[]> =>
    JSON.parse(await readFile(path.join(this.dir(id), 'chat.json'), 'utf8').catch(() => '[]')) as ChatMessage[];

  stop = (): void => this.turn?.abort();

  /** Start over: the conversation goes, the session too. */
  async reset(id: string): Promise<void> {
    if (this.working) throw new Error('Wait until Claude has finished, or stop it.');
    await rm(path.join(this.dir(id), 'chat.json'), { force: true });
    await rm(path.join(this.dir(id), 'session'), { force: true });
  }

  async send(id: string, t: Turn): Promise<void> {
    if (this.working) throw new Error('Claude is still answering.');
    this.working = true;
    const dir = this.dir(id);
    await mkdir(dir, { recursive: true });
    const messages = await this.load(id);
    const reply: ChatMessage = { role: 'assistant', parts: [] };
    messages.push({ role: 'user', parts: [{ type: 'text', text: t.text }], ...(t.files?.length ? { files: t.files } : {}) }, reply);
    const forward = (event: AgentEvent): void => {
      const tail = reply.parts.at(-1);
      if (event.type === 'text' && tail?.type === 'text') tail.text += event.text;
      else if (event.type === 'text' || event.type === 'tool') reply.parts.push({ ...event });
      t.emit(event);
    };
    const config = await brainConfig();
    const sessionFile = path.join(dir, 'session');
    let error: string | undefined;

    const attempt = async (resume?: string): Promise<boolean> => {
      const controller = (this.turn = new AbortController());
      let started = false;
      try {
        for await (const m of query({
          prompt: t.prompt,
          options: {
            cwd: dir,
            ...(resume ? { resume } : {}),
            abortController: controller,
            env: config.env,
            model: config.model,
            mcpServers: t.mcpServers,
            systemPrompt: { type: 'preset', preset: 'claude_code', append: t.systemPrompt },
            settingSources: [],
            allowedTools: t.allowedTools,
            disallowedTools: t.disallowedTools,
            canUseTool: t.canUseTool,
            includePartialMessages: true,
          },
        })) {
          if (m.type === 'system' && m.subtype === 'init') {
            started = true;
            await writeFile(sessionFile, m.session_id);
          }
          if ('parent_tool_use_id' in m && m.parent_tool_use_id) continue;
          if (m.type === 'stream_event' && m.event.type === 'content_block_delta' && m.event.delta.type === 'text_delta') {
            forward({ type: 'text', text: m.event.delta.text });
          } else if (m.type === 'assistant') {
            for (const block of m.message.content) {
              // ToolSearch only loads Claude's own tools: nothing the user needs to see.
              if (block.type !== 'tool_use' || block.name === 'ToolSearch') continue;
              const step = t.describe(block.name, block.input as Record<string, unknown>);
              if (step) forward({ type: 'tool', text: step });
            }
          } else if (m.type === 'result' && m.is_error) {
            error = 'result' in m ? m.result : `Claude stopped early (${m.subtype}).`;
          }
        }
        return true;
      } catch (cause) {
        if (controller.signal.aborted) return true;
        if (resume && !started) return false; // a session that can no longer be resumed: start a fresh one
        error = (cause as Error).message;
        return true;
      }
    };

    try {
      const resume = existsSync(sessionFile) ? await readFile(sessionFile, 'utf8') : undefined;
      if (!(await attempt(resume))) {
        await rm(sessionFile, { force: true });
        await attempt();
      }
    } finally {
      if (error) reply.parts.push({ type: 'text', text: error });
      reply.error = !!error;
      await writeFile(path.join(dir, 'chat.json'), JSON.stringify(messages)).catch(() => {});
      this.working = false;
      t.emit({ type: 'done', error });
    }
  }
}
