import { readFile } from 'node:fs/promises';
import { z } from 'zod/v3';
import { whisperModelNameSchema } from '@shared/schema/models';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const toolNameSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);
export const versionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
const entry = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/).refine((value) => !value.split('/').some((part) => part === '..' || part === '.' || !part));
const https = z.string().url().refine((value) => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443'); });
const host = z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
const hosts = { allowedHosts: z.array(host).min(1), allowedHostSuffixes: z.array(z.string().regex(/^\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/)).optional() };
export const toolPinSchema = z.object({
  name: toolNameSchema, version: versionSchema, arch: z.enum(['arm64', 'x64', 'universal']), bundled: z.boolean(),
  source: z.object({ url: https.optional(), format: z.enum(['zip', 'raw', 'build']), entry: entry.optional() }).strict(),
  checksum: z.object({ url: https, format: z.enum(['single', 'sums']), entry: entry.optional() }).strict().nullable(),
  ...hosts, archiveSha256: digest.nullable(), sha256: digest.nullable(), sourceSha256: digest.nullable().optional(), updatable: z.boolean(), license: z.string().min(1),
}).strict().superRefine((pin, ctx) => {
  if (pin.source.format !== 'build' && (!pin.source.url || !pin.checksum)) ctx.addIssue({ code: 'custom', message: 'Download source and checksum are required.' });
  if (pin.source.format === 'zip' && !pin.source.entry) ctx.addIssue({ code: 'custom', message: 'ZIP entry is required.' });
  if (pin.checksum?.format === 'sums' && !pin.checksum.entry) ctx.addIssue({ code: 'custom', message: 'Checksum entry is required.' });
});
export type ToolPin = z.infer<typeof toolPinSchema>;
export const modelPinSchema = z.object({ name: whisperModelNameSchema, url: https, sizeBytes: z.number().int().positive(), sha256: digest, ...hosts }).strict();
export type ModelPin = z.infer<typeof modelPinSchema>;
export const buildToolPinSchema = z.object({
  name: z.literal('cmake'), version: versionSchema, arch: z.literal('universal'), url: https,
  checksum: z.object({ url: https, format: z.literal('sums'), entry }).strict(), ...hosts,
}).strict();
export type BuildToolPin = z.infer<typeof buildToolPinSchema>;
const manifestSchema = z.object({ schemaVersion: z.literal(2), tools: z.array(toolPinSchema), models: z.array(modelPinSchema).default([]), buildTools: z.array(buildToolPinSchema).optional() }).strict();
export type ToolsManifest = z.infer<typeof manifestSchema>;
export function parseManifest(value: unknown): ToolsManifest {
  const manifest = manifestSchema.parse(value);
  const keys = [...manifest.tools.map((pin) => `tool/${pin.name}/${pin.version}/${pin.arch}`), ...(manifest.buildTools ?? []).map((pin) => `build/${pin.name}/${pin.version}/${pin.arch}`)];
  if (new Set(keys).size !== keys.length || new Set(manifest.models.map((pin) => pin.name)).size !== manifest.models.length) throw new Error('Duplicate manifest pin.');
  return manifest;
}
export async function readManifest(file: string): Promise<ToolsManifest> { return parseManifest(JSON.parse(await readFile(file, 'utf8')) as unknown); }
export function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number); const b = right.split('.').map(Number);
  for (let i = 0; i < 3; i++) { const difference = (a[i] ?? 0) - (b[i] ?? 0); if (difference) return difference; }
  return 0;
}
