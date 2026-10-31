import { z } from 'zod/v3';

export const propDefinitionSchema = z.object({
  type: z.enum(['text', 'color', 'gradient', 'number', 'font', 'enum', 'boolean', 'image']),
  bind: z.string().regex(/^(text|src|css:--[A-Za-z_][A-Za-z0-9_-]*|attr:data-prop-[A-Za-z][A-Za-z0-9_-]*)$/),
  default: z.unknown().refine((value) => value !== undefined, 'Default is required'),
  min: z.number().finite().optional(), max: z.number().finite().optional(), options: z.array(z.string()).optional(),
}).strict();
export const propsDocSchema = z.object({
  version: z.literal(1),
  elements: z.array(z.object({
    id: z.string().min(1), name: z.string(), kind: z.string().min(1), props: z.record(propDefinitionSchema),
  }).strict()),
}).strict().superRefine((doc, ctx) => {
  const ids = new Set<string>();
  for (const element of doc.elements) {
    if (ids.has(element.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate cut id' });
    ids.add(element.id);
    for (const prop of Object.values(element.props)) {
      if (prop.min !== undefined && prop.max !== undefined && prop.min > prop.max) ctx.addIssue({ code: 'custom', message: 'min exceeds max' });
      const expected = prop.type === 'number' ? 'number' : prop.type === 'boolean' ? 'boolean' : 'string';
      if (typeof prop.default !== expected) ctx.addIssue({ code: 'custom', message: 'Default does not match prop type' });
      if (typeof prop.default === 'number' && (!Number.isFinite(prop.default) || (prop.min !== undefined && prop.default < prop.min) || (prop.max !== undefined && prop.default > prop.max))) ctx.addIssue({ code: 'custom', message: 'Default out of range' });
      if (prop.type === 'enum' && (!prop.options?.length || !prop.options.includes(String(prop.default)))) ctx.addIssue({ code: 'custom', message: 'Enum default must be an option' });
    }
  }
});
export type PropsDoc = z.infer<typeof propsDocSchema>;
export type PropDefinition = z.infer<typeof propDefinitionSchema>;
export const PropsDocSchema = propsDocSchema;
