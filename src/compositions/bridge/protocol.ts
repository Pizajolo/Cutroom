import { z } from 'zod/v3';
import { propsDocSchema } from '../../shared/schema/props';
export const BRIDGE_VERSION = 1;
const base = { version: z.literal(BRIDGE_VERSION), id: z.string().min(1).max(100) };
const values = z.record(z.record(z.unknown()));
export const commandSchema = z.discriminatedUnion('command', [
  z.object({ ...base, command: z.literal('load'), schema: propsDocSchema.optional(), props: values.optional() }).strict(),
  z.object({ ...base, command: z.literal('seek'), time: z.number().finite().nonnegative() }).strict(),
  z.object({ ...base, command: z.literal('play') }).strict(),
  z.object({ ...base, command: z.literal('pause') }).strict(),
  z.object({ ...base, command: z.literal('setProps'), schema: propsDocSchema.optional(), props: values }).strict(),
  z.object({ ...base, command: z.literal('hitTest'), x: z.number().finite(), y: z.number().finite() }).strict(),
  z.object({ ...base, command: z.literal('domSnapshot') }).strict(),
]);
export type BridgeCommand = z.infer<typeof commandSchema>;
export type CommandInput = BridgeCommand extends infer C ? C extends BridgeCommand ? Omit<C, 'version' | 'id'> : never : never;
export const responseSchema = z.object({ ...base, ok: z.boolean(), result: z.unknown().optional(), error: z.string().max(2000).optional() }).strict();
export const readySchema = z.object({ type: z.literal('cutroom-bridge-ready'), nonce: z.string().min(16).max(100) }).strict();
export const initSchema = z.object({ type: z.literal('cutroom-bridge-init'), nonce: z.string().min(16).max(100) }).strict();
