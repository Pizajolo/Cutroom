import { z } from 'zod/v3';

export const skillIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const videoSkillSchema = z.object({
  id: skillIdSchema, name: z.string().trim().min(1).max(200), description: z.string().max(2000),
  source: z.enum(['builtin', 'user']), compositions: z.array(z.string()), updatedAt: z.string().datetime(),
}).strict();
export const videoSkillDetailSchema = videoSkillSchema.extend({ instructions: z.string().trim().min(1).max(100_000) }).strict();
export type VideoSkill = z.infer<typeof videoSkillSchema>;
export type VideoSkillDetail = z.infer<typeof videoSkillDetailSchema>;
