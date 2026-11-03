import * as schemas from './index';
import { historyOpSchema, opSchema } from '../timeline/types';

// Shared by the artifact generator and in-memory draft-07 validation tests.
export const schemaCatalog = {
  timeline: schemas.timelineDocSchema, props: schemas.propsDocSchema, project: schemas.projectDocSchema,
  events: schemas.eventEnvelopeSchema, jobs: schemas.jobInfoSchema, settings: schemas.globalSettingsSchema,
  tools: schemas.toolInfoSchema, install: schemas.installStateSchema, models: schemas.whisperModelInfoSchema,
  accounts: schemas.accountInfoSchema, claudeCodeStatus: schemas.claudeCodeStatusSchema,
  folderGrant: schemas.folderGrantSchema, projectSession: schemas.projectSessionSchema, recentProject: schemas.recentProjectSchema,
  projectOpenResult: schemas.projectOpenResultSchema, projectCreateResult: schemas.projectCreateResultSchema, timelineState: schemas.timelineStateSchema, timelineChanged: schemas.timelineChangedSchema,
  historyEntry: schemas.historyEntrySchema, publicOp: opSchema, historyOp: historyOpSchema,
  exportPreset: schemas.exportPresetSchema, exportPreflight: schemas.exportPreflightSchema, timeRange: schemas.timeRangeSchema,
  settingsPatch: schemas.settingsPatchSchema, voiceInputSettings: schemas.voiceInputSettingsSchema,
  sandboxSettings: schemas.sandboxSettingsSchema, snapshotSettings: schemas.snapshotSettingsSchema, renderPresetsSettings: schemas.renderPresetsSettingsSchema,
  storageUsage: schemas.storageUsageSchema, storageItem: schemas.storageItemSchema, storageCategory: schemas.storageCategorySchema,
  cleanPreview: schemas.cleanPreviewSchema, snapshotInfo: schemas.snapshotInfoSchema,
  transcript: schemas.transcriptSchema, urlMetadata: schemas.urlMetadataSchema, urlFormat: schemas.urlFormatSchema,
  compositionTemplate: schemas.compositionTemplateSchema, compositionInfo: schemas.compositionInfoSchema, compositionCheck: schemas.compositionCheckSchema,
  agentSession: schemas.agentSessionSchema, agentContext: schemas.agentContextSchema, agentEvent: schemas.agentEventSchema, codexStatus: schemas.codexStatusSchema,
  audioGenerate: schemas.audioGenerateRequestSchema, audioVoice: schemas.audioVoiceSchema,
  extensionConfig: schemas.extensionConfigSchema, storedExtension: schemas.storedExtensionSchema, extensionInfo: schemas.extensionInfoSchema, extensionValidation: schemas.extensionValidationSchema,
} as const;
