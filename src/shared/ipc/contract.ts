import { z } from 'zod/v3';
import { formatSchema, positiveSchema, projectPathSchema } from '../schema/common';
import { folderGrantIdSchema, folderGrantSchema, projectNameSchema, projectOpenResultSchema, projectSessionSchema, recentProjectSchema } from '../schema/project';
import { timelineStateSchema, timelineChangedSchema, historyEntrySchema, storageUsageSchema, cleanPreviewSchema, storageCategorySchema, snapshotInfoSchema } from '../schema/editor';
import { opSchema } from '../timeline/types';
import { itemIdSchema } from '../schema/timeline';
import { jobInfoSchema } from '../schema/jobs';
import { exportPresetSchema, exportPreflightSchema, timeRangeSchema } from '../schema/export';
import { globalSettingsSchema, settingsPatchSchema } from '../schema/settings';
import { transcriptSchema, transcriptionEngineSchema, voiceTranscribeRequestSchema } from '../schema/transcripts';
import { importUrlSchema, urlMetadataSchema } from '../schema/urlImport';
import { compositionCheckSchema, compositionInfoSchema, compositionNameSchema, compositionTemplateSchema } from '../schema/compositions';
import { agentContextSchema, agentEventSchema, agentModeSchema, agentSessionSchema, codexStatusSchema } from '../schema/agent';
import { audioGenerateRequestSchema, audioKindSchema, audioVoiceSchema } from '../schema/audio';
import { extensionConfigSchema, extensionIdSchema, extensionInfoSchema, extensionValidationSchema, secretEnvNameSchema } from '../schema/extensions';
import { toolInfoSchema, mediaFileSchema, thumbnailSchema, waveformSchema, importDestinationSchema } from '../schema/media';
import { whisperModelInfoSchema, whisperModelNameSchema } from '../schema/models';
import { accountInfoSchema, accountMethodSchema, claudeCodeStatusSchema, providerSchema } from '../schema/accounts';

const toolRequestSchema = z.object({ name: z.string().regex(/^[a-z][a-z0-9-]*$/) }).strict();
const modelRequestSchema = z.object({ name: whisperModelNameSchema }).strict();
const providerRequestSchema = z.object({ provider: providerSchema }).strict();
const okSchema = z.object({ ok: z.literal(true) }).strict();
const emptySchema = z.object({}).strict();
const idRequestSchema = z.object({ id: z.string().min(1) }).strict();
const sessionRequestSchema = z.object({ sessionId: z.string().min(1) }).strict();
const jobStartedSchema = z.object({ jobId: z.string().min(1) }).strict();
const projectCreation = { name: projectNameSchema, format: formatSchema, defaultEngine: z.enum(['hyperframes', 'remotion']) };
const exportRequest = { presetId: z.string().min(1), range: timeRangeSchema.optional() };
const reviewRequest = { requestId: z.string().min(1), itemIds: z.array(itemIdSchema).min(1).optional() };

export const ipcErrorSchema = z.object({
  code: z.enum(['invalid_request', 'not_found', 'forbidden', 'conflict', 'user_edited', 'internal', 'unavailable']),
  message: z.string(), details: z.record(z.unknown()).optional(),
}).strict();
export type IpcError = z.infer<typeof ipcErrorSchema>;
export { IpcFailure } from './errors';
export const contract = {
  invoke: {
    'app.getInfo': {
      req: z.object({}).strict(),
      res: z.object({
        version: z.string(), platform: z.string(), arch: z.string(), homeDir: z.string(),
        mediaBaseUrl: z.string().url().nullable(), compBaseUrl: z.string().url().nullable(),
      }).strict(),
    },
    'app.ping': { req: z.object({}).strict(), res: z.object({ pong: z.literal(true) }).strict() },
    'tools.list': { req: z.object({}).strict(), res: z.array(toolInfoSchema) },
    'tools.install': { req: toolRequestSchema, res: okSchema },
    'tools.cancelInstall': { req: toolRequestSchema, res: okSchema },
    'tools.checkUpdate': { req: toolRequestSchema, res: z.object({ current: z.string(), latest: z.string().nullable() }).strict() },
    'tools.update': { req: toolRequestSchema, res: okSchema },
    'models.list': { req: z.object({}).strict(), res: z.array(whisperModelInfoSchema) },
    'models.download': { req: modelRequestSchema, res: okSchema },
    'models.cancel': { req: modelRequestSchema, res: okSchema },
    'models.delete': { req: modelRequestSchema, res: okSchema },
    'models.setDefault': { req: modelRequestSchema, res: z.array(whisperModelInfoSchema) },
    'accounts.list': { req: z.object({}).strict(), res: z.array(accountInfoSchema) },
    'accounts.connectKey': { req: z.object({ provider: providerSchema, apiKey: z.string().trim().min(8).max(512).regex(/^\S+$/) }).strict(), res: accountInfoSchema },
    'accounts.disconnect': { req: providerRequestSchema, res: accountInfoSchema },
    'accounts.verify': { req: providerRequestSchema, res: accountInfoSchema },
    'accounts.claude.setMethod': { req: z.object({ method: accountMethodSchema }).strict(), res: accountInfoSchema },
    'accounts.claudeCode.status': { req: z.object({}).strict(), res: claudeCodeStatusSchema },
    'accounts.claudeCode.openLogin': { req: z.object({}).strict(), res: okSchema },
    'dialog.pickFolder': { req: z.object({ purpose: z.enum(['projectParent', 'footage', 'openProject']) }).strict(), res: folderGrantSchema.nullable() },
    'project.create': { req: z.object({ ...projectCreation, parentGrant: folderGrantIdSchema, footageGrant: folderGrantIdSchema.optional() }).strict(), res: projectSessionSchema },
    'project.open': { req: z.union([z.object({ grantId: folderGrantIdSchema }).strict(), z.object({ recentId: z.string().min(1) }).strict()]), res: projectOpenResultSchema },
    'project.createInPlace': { req: z.object({ ...projectCreation, grantId: folderGrantIdSchema }).strict(), res: projectSessionSchema },
    'project.current': { req: emptySchema, res: projectSessionSchema.nullable() },
    'project.close': { req: emptySchema, res: okSchema },
    'project.listRecent': { req: emptySchema, res: z.array(recentProjectSchema) },
    'project.removeRecent': { req: idRequestSchema, res: okSchema },
    'project.adoptLooseMedia': { req: z.object({ rels: z.array(projectPathSchema).min(1).max(1000) }).strict(), res: z.array(mediaFileSchema) },
    'timeline.get': { req: emptySchema, res: timelineStateSchema },
    'timeline.apply': { req: z.object({ ops: z.array(opSchema).min(1).max(1000), label: z.string().min(1).max(500), baseRevision: z.number().int().nonnegative().optional() }).strict(), res: timelineStateSchema },
    'timeline.undo': { req: emptySchema, res: timelineStateSchema },
    'timeline.redo': { req: emptySchema, res: timelineStateSchema },
    'timeline.history': { req: emptySchema, res: z.array(historyEntrySchema) },
    'jobs.list': { req: emptySchema, res: z.array(jobInfoSchema) },
    'jobs.cancel': { req: idRequestSchema, res: okSchema },
    'export.presets': { req: emptySchema, res: z.array(exportPresetSchema) },
    'export.preflight': { req: z.object(exportRequest).strict(), res: exportPreflightSchema },
    'export.start': { req: z.object({ ...exportRequest, acknowledgeUnsupported: z.boolean() }).strict(), res: jobStartedSchema },
    'shell.openInProject': { req: z.object({ rel: projectPathSchema.refine((rel) => /^(final|audio)\/.+/.test(rel), 'Only final/ and audio/ files may be opened') }).strict(), res: okSchema },
    'settings.get': { req: emptySchema, res: globalSettingsSchema },
    'settings.update': { req: z.object({ patch: settingsPatchSchema }).strict(), res: globalSettingsSchema },
    'storage.usage': { req: emptySchema, res: storageUsageSchema },
    'storage.cleanPreview': { req: z.object({ categories: z.array(storageCategorySchema).min(1) }).strict(), res: cleanPreviewSchema },
    'storage.clean': { req: z.object({ token: z.string().min(1) }).strict(), res: okSchema },
    'snapshots.list': { req: emptySchema, res: z.array(snapshotInfoSchema) },
    'snapshots.create': { req: z.object({ label: z.string().trim().min(1).max(500) }).strict(), res: snapshotInfoSchema },
    'snapshots.restore': { req: idRequestSchema, res: timelineStateSchema },
    'snapshots.delete': { req: idRequestSchema, res: okSchema },
    'transcripts.get': { req: z.object({ rel: projectPathSchema }).strict(), res: transcriptSchema.nullable() },
    'transcripts.start': { req: z.object({ rel: projectPathSchema, engine: transcriptionEngineSchema, model: z.string().min(1).max(200).optional() }).strict(), res: jobStartedSchema },
    'captions.generate': { req: z.object({ clipItemId: itemIdSchema.refine((id) => id.startsWith('clip_'), 'Expected a clip id') }).strict(), res: timelineStateSchema },
    'voice.transcribe': { req: voiceTranscribeRequestSchema, res: z.object({ text: z.string() }).strict() },
    'urlImport.fetch': { req: z.object({ url: importUrlSchema }).strict(), res: urlMetadataSchema },
    'urlImport.download': { req: z.object({ url: importUrlSchema, formatId: z.string().min(1).max(200), destination: importDestinationSchema, rightsConfirmed: z.literal(true) }).strict(), res: jobStartedSchema },
    'compositions.templates': { req: emptySchema, res: z.array(compositionTemplateSchema) },
    'compositions.list': { req: emptySchema, res: z.array(compositionInfoSchema) },
    'compositions.create': { req: z.object({ template: z.string().min(1), name: compositionNameSchema }).strict(), res: compositionInfoSchema },
    'compositions.check': { req: z.object({ name: compositionNameSchema }).strict(), res: compositionCheckSchema },
    'compositions.render': { req: z.object({ itemId: itemIdSchema.refine((id) => id.startsWith('composition_'), 'Expected a composition id') }).strict(), res: jobStartedSchema },
    'agent.sessions.list': { req: emptySchema, res: z.array(agentSessionSchema) },
    'agent.start': { req: z.object({ mode: agentModeSchema, model: z.string().min(1).max(200).optional() }).strict(), res: z.object({ sessionId: z.string().min(1) }).strict() },
    'agent.send': { req: z.object({ sessionId: z.string().min(1), text: z.string().trim().min(1).max(100_000), context: agentContextSchema.optional() }).strict(), res: okSchema },
    'agent.interrupt': { req: sessionRequestSchema, res: okSchema },
    'agent.respondPermission': { req: z.object({ requestId: z.string().min(1), allow: z.boolean(), message: z.string().max(5000).optional() }).strict(), res: okSchema },
    'agent.review.keep': { req: z.object(reviewRequest).strict(), res: timelineStateSchema },
    'agent.review.revert': { req: z.object({ ...reviewRequest, resolution: z.enum(['keepCurrent', 'restoreOriginal']).optional() }).strict(), res: timelineStateSchema },
    'accounts.codex.status': { req: emptySchema, res: codexStatusSchema },
    'accounts.codex.openLogin': { req: emptySchema, res: okSchema },
    'audio.voices': { req: emptySchema, res: z.array(audioVoiceSchema) },
    'audio.estimate': { req: z.object({ kind: audioKindSchema, text: z.string().max(50_000).optional(), durationSec: positiveSchema.optional() }).strict(), res: z.object({ credits: z.number().finite().nonnegative().nullable() }).strict() },
    'audio.generate': { req: audioGenerateRequestSchema, res: jobStartedSchema },
    'extensions.list': { req: emptySchema, res: z.array(extensionInfoSchema) },
    'extensions.validate': { req: z.object({ config: extensionConfigSchema }).strict(), res: extensionValidationSchema },
    'extensions.add': { req: z.object({ config: extensionConfigSchema, secretEnv: z.record(secretEnvNameSchema, z.string().min(1).max(16_384)).optional() }).strict(), res: extensionInfoSchema },
    'extensions.remove': { req: z.object({ id: extensionIdSchema }).strict(), res: okSchema },
    'extensions.setEnabled': { req: z.object({ id: extensionIdSchema, enabled: z.boolean() }).strict(), res: extensionInfoSchema },
    // Legacy media-folder handoff stays available until the renderer migrates.
    'media.selectProjectFolder': { req: z.object({}).strict(), res: z.object({ id: z.string(), root: z.string() }).strict().nullable() },
    'media.list': { req: z.object({}).strict(), res: z.array(mediaFileSchema) },
    'media.cancel': { req: z.object({}).strict(), res: z.object({ ok: z.literal(true) }).strict() },
    'media.importPaths': { req: z.object({ paths: z.array(z.string().min(1)).min(1).max(100), destination: importDestinationSchema }).strict(), res: z.array(mediaFileSchema) },
    'media.importDialog': { req: z.object({ destination: importDestinationSchema }).strict(), res: z.array(mediaFileSchema) },
    'media.thumbnails': { req: z.object({ rel: projectPathSchema }).strict(), res: thumbnailSchema },
    'media.waveform': { req: z.object({ rel: projectPathSchema }).strict(), res: waveformSchema },
    'shell.revealInProject': { req: z.object({ rel: projectPathSchema }).strict(), res: z.object({ ok: z.literal(true) }).strict() },
  },
  events: {
    'app.ready': z.object({ version: z.string() }).strict(),
    'tools.changed': z.array(toolInfoSchema),
    'models.changed': z.array(whisperModelInfoSchema),
    'accounts.changed': z.array(accountInfoSchema),
    'project.changed': projectSessionSchema.nullable(),
    'timeline.changed': timelineChangedSchema,
    'jobs.changed': z.array(jobInfoSchema),
    'settings.changed': globalSettingsSchema,
    'agent.event': agentEventSchema,
    'media.changed': z.object({ projectId: z.string(), rels: z.array(projectPathSchema) }).strict(),
    'media.progress': z.object({ projectId: z.string(), rel: projectPathSchema, stage: z.enum(['probe', 'thumbnails', 'waveform', 'import']), progress: z.number().finite().min(0).max(1) }).strict(),
  },
} as const;
export type InvokeChannel = keyof typeof contract.invoke;
export type EventName = keyof typeof contract.events;
export type InvokeReq<C extends InvokeChannel> = z.input<(typeof contract.invoke)[C]['req']>;
export type InvokeRes<C extends InvokeChannel> = z.output<(typeof contract.invoke)[C]['res']>;
export type EventPayload<E extends EventName> = z.output<(typeof contract.events)[E]>;
export type IpcReply<T> = { ok: true; data: T } | { ok: false; error: IpcError };
