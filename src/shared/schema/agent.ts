import { z } from 'zod/v3';
import { secondsSchema } from './common';
import { itemIdSchema, itemSchema } from './timeline';
import { timeRangeSchema } from './export';

export const agentModeSchema = z.enum(['edit', 'ask']);
export const agentStatusSchema = z.enum(['starting', 'idle', 'thinking', 'running', 'waiting_permission', 'interrupted', 'finished']);
export const agentSessionSchema = z.object({
  id: z.string().min(1), projectId: z.string().min(1), mode: agentModeSchema, model: z.string(), status: agentStatusSchema, createdAt: z.string().datetime(),
}).strict();
export const agentContextSchema = z.object({ itemIds: z.array(itemIdSchema), time: secondsSchema, range: timeRangeSchema.optional() }).strict();
const session = { sessionId: z.string().min(1) };
export const agentEventSchema = z.discriminatedUnion('type', [
  z.object({ ...session, type: z.literal('status'), status: agentStatusSchema }).strict(),
  z.object({ ...session, type: z.literal('text_delta'), text: z.string() }).strict(),
  z.object({ ...session, type: z.literal('playhead_seek'), time: secondsSchema }).strict(),
  z.object({ ...session, type: z.literal('message'), role: z.enum(['user', 'assistant']), text: z.string() }).strict(),
  z.object({ ...session, type: z.literal('tool_start'), toolUseId: z.string().min(1), name: z.string(), input: z.record(z.unknown()) }).strict(),
  z.object({ ...session, type: z.literal('tool_end'), toolUseId: z.string().min(1), name: z.string(), output: z.unknown(), isError: z.boolean() }).strict(),
  z.object({ ...session, type: z.literal('permission_request'), requestId: z.string().min(1), tool: z.string(), description: z.string(), input: z.record(z.unknown()) }).strict(),
  z.object({ ...session, type: z.literal('change'), requestId: z.string().min(1), itemId: itemIdSchema, paths: z.array(z.string()), before: itemSchema.nullable(), after: itemSchema.nullable() }).strict(),
  z.object({ ...session, type: z.literal('result'), costUsd: z.number().finite().nonnegative().optional(), inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }).strict(),
  z.object({ ...session, type: z.literal('error'), code: z.string(), message: z.string() }).strict(),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;
export type AgentSession = z.infer<typeof agentSessionSchema>;
export const codexStatusSchema = z.object({
  available: z.boolean(), version: z.string().optional(), loggedIn: z.boolean(), mode: z.enum(['chatgpt', 'api-key']).nullable(),
}).strict();
