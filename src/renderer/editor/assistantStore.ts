import { create } from 'zustand';
import { videoSkillSchema } from '@shared/schema/skills';
import type { AgentEvent } from '@shared/schema/agent';
import { api } from '../lib/api';
import { errorMessage, useNavigation } from '../state/navigation';
import type { InvokeReq } from '@shared/ipc';
import { previewClock } from './preview/store';
import { useSelection } from './selection/store';
import { summarizeOperation, type OperationSummary } from './operationSummary';
export const AGENT_MODELS = [{ id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' }, { id: 'claude-opus-5-5', label: 'Opus 5.5' }, { id: 'claude-haiku-5-5', label: 'Haiku 5.5' }];
let projectEpoch = 0;
type Change = Extract<AgentEvent, { type: 'change' }>;
export type Question = Extract<AgentEvent, { type: 'question_request' }>;
type Permission = Extract<AgentEvent, { type: 'permission_request' }>;
interface AssistantState {
  sessionId: string | null; model: string; mode: 'ask' | 'edit'; status: string;
  messages: { role: 'user' | 'assistant'; text: string; streaming?: boolean }[];
  tools: { id: string; name: string; done: boolean; error?: boolean; operation?: OperationSummary }[];
  permissions: Permission[]; questions: Question[]; answeredQuestionIds: string[]; skillId: string | null; changes: Change[]; cost: number | null; draft: string;
  savedSkill: { id: string; name: string } | null; error: string | null; sending: boolean;
  send: (text: string, mode?: 'ask' | 'edit', context?: InvokeReq<'agent.send'>['context']) => Promise<boolean>;
  receive: (event: AgentEvent) => void;
}
export const useAssistant = create<AssistantState>((set, get) => ({
  sessionId: null, model: AGENT_MODELS[0]!.id, mode: 'edit', status: 'idle', messages: [], tools: [], permissions: [], questions: [], answeredQuestionIds: [], skillId: null, changes: [], cost: null, draft: '', savedSkill: null, error: null, sending: false,
  send: async (text, mode = 'edit', frozenContext) => {
    if (get().sending || ['starting', 'thinking', 'running', 'waiting_permission', 'waiting_input'].includes(get().status) || !text.trim()) return false;
    const projectId = useNavigation.getState().project?.project.id;
    if (!projectId) { set({ error: 'Open a project before asking Claude.' }); return false; }
    const range = useSelection.getState().range;
    const context = frozenContext ?? { itemIds: useSelection.getState().elements.map((e) => e.itemId), time: previewClock.getSnapshot().time, ...(range && range.end > range.start ? { range } : {}) };
    const epoch = projectEpoch;
    const current = () => epoch === projectEpoch;
    set({ sending: true, error: null, draft: text });
    let appended = false;
    try {
      let id = get().sessionId;
      if (!id || mode !== get().mode) {
        const value = await api.invoke('agent.start', { mode, model: get().model }); id = value.sessionId;
        if (!current()) return false;
        set({ sessionId: id, mode, tools: [], permissions: [], questions: [], answeredQuestionIds: [], changes: [], cost: null });
      }
      if (!current()) return false;
      set((s) => ({ messages: [...s.messages, { role: 'user', text }], status: 'thinking' })); appended = true;
      await api.invoke('agent.send', { sessionId: id, text, context, ...(get().skillId ? { skillId: get().skillId! } : {}) });
      if (!current()) return false;
      set((s) => ({ draft: s.draft === text ? '' : s.draft }));
      return true;
    } catch (r) {
      if (current()) set((s) => { const messages = [...s.messages]; if (appended) { const index = messages.length - 1 - [...messages].reverse().findIndex((m) => m.role === 'user' && m.text === text); if (index >= 0 && index < messages.length) messages.splice(index, 1); } return { error: errorMessage(r), messages, status: 'idle' }; });
      return false;
    } finally { if (current()) set({ sending: false }); }
  },
  receive: (event) => {
    if (get().sessionId !== event.sessionId) return;
    // Also accepts the backend's additive playhead event during contract integration.
    const type: string = event.type;
    if (type === 'playhead_seek' && 'time' in event && typeof event.time === 'number' && Number.isFinite(event.time)) { previewClock.seek(event.time); return; }
    switch (event.type) {
      case 'text_delta': set((s) => { const messages = [...s.messages]; const last = messages.at(-1); if (last?.role === 'assistant' && last.streaming) messages[messages.length - 1] = { ...last, text: last.text + event.text }; else messages.push({ role: 'assistant', text: event.text, streaming: true }); return { messages }; }); break;
      case 'message': set((s) => { const messages = [...s.messages]; if (messages.at(-1)?.streaming && event.role === 'assistant') messages[messages.length - 1] = { role: event.role, text: event.text }; else if (messages.at(-1)?.role !== event.role || messages.at(-1)?.text !== event.text) messages.push({ role: event.role, text: event.text }); return { messages }; }); break;
      case 'status': set({ status: event.status }); break;
      case 'tool_start': set((s) => ({ tools: [...s.tools, { id: event.toolUseId, name: event.name, done: false, operation: summarizeOperation(event.input) }] })); break;
      case 'tool_end': {
        set((s) => ({ tools: s.tools.map((t) => t.id === event.toolUseId ? { ...t, done: true, error: event.isError } : t) }));
        if (!event.isError && /(?:^|__)skill_save$/.test(event.name) && typeof event.output === 'string') {
          try { const result = videoSkillSchema.pick({ id: true, name: true }).safeParse(JSON.parse(event.output)); if (result.success) set({ savedSkill: { id: result.data.id, name: result.data.name } }); } catch { /* Non-JSON tool output is not a saved-skill confirmation. */ }
        }
        break;
      }
      case 'question_request': set((s) => ({ status: 'waiting_input', questions: [...s.questions.filter((q) => q.requestId !== event.requestId), event] })); break;
      case 'permission_request': set((s) => ({ status: 'waiting_permission', permissions: [...s.permissions.filter((p) => p.requestId !== event.requestId), event] })); break;
      case 'change': set((s) => ({ changes: [...s.changes.filter((c) => c.requestId !== event.requestId || c.itemId !== event.itemId), event] })); break;
      case 'result': set({ cost: event.costUsd ?? null, status: 'finished' }); break;
      case 'error': set({ error: event.message, status: 'interrupted' }); break;
    }
  },
}));
useNavigation.subscribe((next, previous) => {
  if (next.project?.project.id === previous.project?.project.id) return;
  projectEpoch++;
  useAssistant.setState({ sessionId: null, status: 'idle', messages: [], tools: [], permissions: [], questions: [], answeredQuestionIds: [], changes: [], cost: null, draft: '', savedSkill: null, error: null, sending: false });
});
