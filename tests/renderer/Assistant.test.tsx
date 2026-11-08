import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { defaultGlobalSettings } from '@shared/schema/settings';
import { Assistant, QuestionCard } from '../../src/renderer/editor/Assistant';
import { useAssistant, type Question } from '../../src/renderer/editor/assistantStore';
import { useNavigation } from '../../src/renderer/state/navigation';
import { defaultReply, session } from './fixtures';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../src/renderer/lib/api', () => ({ api: { invoke: mocks.invoke, on: () => () => {} } }));
const question: Question = { type: 'question_request', sessionId: 'agent1', requestId: 'brief', questions: [
  { question: 'Who is this for?', header: 'Audience', multiSelect: false, options: [{ label: 'Customers', description: 'New viewers' }, { label: '__other', description: 'A literal option label' }] },
  { question: 'Which elements?', header: 'Content', multiSelect: true, options: [{ label: 'Titles', description: '' }, { label: 'Voice', description: '' }] },
] };
beforeEach(() => {
  mocks.invoke.mockReset(); mocks.invoke.mockImplementation(async (channel: string) => channel === 'agent.start' ? { sessionId: 'agent1' } : defaultReply(channel));
  useNavigation.setState({ project: session, destination: 'project' });
  useAssistant.setState({ sessionId: 'agent1', status: 'idle', messages: [], questions: [], permissions: [], answeredQuestionIds: [], tools: [], changes: [], savedSkill: null, skillId: null, draft: '', error: null, sending: false });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(cleanup);

it('requires each answer and sends exact question keys, multi-select and custom text', async () => {
  render(<QuestionCard request={question} inactive={false} />);
  const submit = screen.getByRole('button', { name: 'Send answers' }); expect((submit as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: /Customers/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Titles' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Other' }));
  expect((submit as HTMLButtonElement).disabled).toBe(true); fireEvent.change(screen.getByLabelText('Other answer'), { target: { value: '  Product close-ups  ' } });
  fireEvent.click(submit);
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('agent.respondQuestion', { requestId: 'brief', answers: { 'Who is this for?': 'Customers', 'Which elements?': ['Titles', 'Product close-ups'] } }));
  expect(await screen.findByText('Answers sent')).toBeTruthy(); expect(useAssistant.getState().answeredQuestionIds).toEqual(['brief']);
});
it('retains answers after failure and treats a literal __other option as an ordinary choice', async () => {
  mocks.invoke.mockRejectedValueOnce(new Error('Connection interrupted.'));
  render(<QuestionCard request={question} inactive={false} />);
  fireEvent.click(screen.getByRole('radio', { name: /__other/ })); fireEvent.click(screen.getByRole('checkbox', { name: 'Voice' }));
  fireEvent.click(screen.getByRole('button', { name: 'Send answers' }));
  await screen.findByText('Connection interrupted.'); expect((screen.getByRole('radio', { name: /__other/ }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('Answers sent');
  expect(mocks.invoke).toHaveBeenLastCalledWith('agent.respondQuestion', { requestId: 'brief', answers: { 'Who is this for?': '__other', 'Which elements?': ['Voice'] } });
});
it('keeps an interrupted question readable but disables sending', () => {
  const { rerender } = render(<QuestionCard request={question} inactive={false} />);
  fireEvent.click(screen.getByRole('radio', { name: /Customers/ }));
  rerender(<QuestionCard request={question} inactive />);
  expect((screen.getByRole('radio', { name: /Customers/ }) as HTMLInputElement).checked).toBe(true); expect(screen.getByRole('radio', { name: /Customers/ }).closest('fieldset')!.disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'Send answers' })).toBeNull(); expect(screen.getByText('No longer waiting')).toBeTruthy();
});
it('sends only plain Enter, preserves the draft on send error and permits retry', async () => {
  mocks.invoke.mockImplementation(async (channel: string) => { if (channel === 'agent.send') throw new Error('Send unavailable.'); return defaultReply(channel); });
  useAssistant.setState({ draft: 'Make this shorter' }); render(<Assistant />);
  const composer = screen.getByRole('textbox', { name: 'Message Claude' });
  fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true }); fireEvent.keyDown(composer, { key: 'Enter', isComposing: true });
  expect(mocks.invoke.mock.calls.filter(([channel]) => channel === 'agent.send')).toEqual([]);
  fireEvent.keyDown(composer, { key: 'Enter' });
  await screen.findByText('Send unavailable.'); expect((composer as HTMLTextAreaElement).value).toBe('Make this shorter'); expect(useAssistant.getState().status).toBe('idle');
  expect((screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(false); expect(useAssistant.getState().messages).toEqual([]);
});
it('keeps the last saved approval mode on update failure and only exposes session scope for rememberable tools', async () => {
  const settings = defaultGlobalSettings(); settings.agent.approvalMode = 'ask';
  mocks.invoke.mockImplementation(async (channel: string) => { if (channel === 'settings.get') return settings; if (channel === 'settings.update') throw new Error('Settings could not be saved.'); return defaultReply(channel); });
  useAssistant.getState().receive({ type: 'permission_request', sessionId: 'agent1', requestId: 'extension', tool: 'extension', description: 'Run extension?', input: {}, rememberable: true });
  useAssistant.getState().receive({ type: 'permission_request', sessionId: 'agent1', requestId: 'save', tool: 'skill_save', description: 'Save skill?', input: {}, rememberable: false });
  render(<Assistant />); const toggle = await screen.findByRole('switch', { name: 'Auto-approve' }); await waitFor(() => expect((toggle as HTMLInputElement).disabled).toBe(false));
  fireEvent.click(toggle); await screen.findByText('Settings could not be saved.'); expect((toggle as HTMLInputElement).checked).toBe(false);
  const sessionAllow = screen.getByRole('button', { name: 'Allow for this session' }); fireEvent.click(sessionAllow);
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('agent.respondPermission', { requestId: 'extension', allow: true, scope: 'session' }));
  expect(screen.queryByRole('button', { name: 'Allow for this session' })).toBeNull();
  expect(within(screen.getByText('Save skill?').closest('section')!).getByRole('button', { name: 'Allow once' })).toBeTruthy();
});
it('only confirms a successful, validated skill_save result and opens the skill library', () => {
  render(<Assistant />);
  const result = (output: unknown, isError = false, name = 'mcp__cutroom__skill_save') => act(() => useAssistant.getState().receive({ type: 'tool_end', sessionId: 'agent1', toolUseId: 'save1', name, output, isError }));
  result('{"id":"coast","name":"Coast"}', true); result('{truncated'); result('{"id":"../coast","name":"Coast"}'); result('{"id":"coast","name":""}'); result('{"id":"coast","name":"Coast"}', false, 'other_tool');
  expect(screen.queryByRole('button', { name: 'View skill' })).toBeNull();
  result('{"id":"coast","name":"Coast"}'); expect(screen.getByText('Saved as Coast.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'View skill' })); expect(useNavigation.getState().destination).toBe('skills'); expect(useAssistant.getState().skillId).toBe('coast');
});
it('ignores events from an old session and never sends a second request while waiting for answers', async () => {
  useAssistant.setState({ status: 'waiting_input', draft: 'Keep this draft' });
  useAssistant.getState().receive({ ...question, sessionId: 'old' }); expect(useAssistant.getState().questions).toEqual([]);
  expect(await useAssistant.getState().send('Another request')).toBe(false); expect(mocks.invoke).not.toHaveBeenCalled();
});
