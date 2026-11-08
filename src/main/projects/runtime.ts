import { IpcFailure, type EventName, type EventPayload } from '@shared/ipc/contract';
import { ProjectService } from './service';
import { TimelineService } from '../timeline/service';
import { JobQueue } from '../jobs/queue';
import type { MediaService } from '../media/service';
import { SettingsService } from '../settings/service';
import type { SettingsStore } from '../settings/store';
import { ExportService } from '../render/service';
import { StorageService } from '../settings/storage';
import { ExtensionsService } from '../settings/extensions';
import type { ExtensionSecretStore } from '../secrets/keychain';
import { CodexService } from '../codex/service';
import { CompositionsService } from '../compositions/service';
import { ElevenLabsClient } from '../elevenlabs/client';
import { AudioService } from '../elevenlabs/audio';
import { TranscriptsService } from '../transcripts/service';
import type { SecretStore } from '../secrets/keychain';
import { UrlImportService } from '../urlImport/service';
import { AgentService } from '../agent/service';
import { OverlayService } from '../render/overlays';
import { SkillsService } from '../skills/service';

export class WorkflowRuntime {
  readonly projects: ProjectService; readonly jobs: JobQueue; readonly settings: SettingsService; readonly exports: ExportService; readonly storage: StorageService; readonly extensions: ExtensionsService; readonly codex = new CodexService(); readonly compositions: CompositionsService;
  readonly agent: AgentService; readonly skills: SkillsService;
  readonly overlays: OverlayService;
  readonly urls: UrlImportService;
  readonly audio: AudioService; readonly transcripts: TranscriptsService; readonly elevenlabs: ElevenLabsClient;
  private activeTimeline: TimelineService | null = null;
  constructor(options: { home: string; media: MediaService; store: SettingsStore; secrets: ExtensionSecretStore & SecretStore; compositionsRoot: string; compositionBaseUrl: string; skillsRoot: string; resolveModel: (name: string) => Promise<string>; resolveTool: (name: string) => Promise<string>; emit: <E extends EventName>(event: E, value: EventPayload<E>) => void }) {
    this.jobs = new JobQueue((jobs) => options.emit('jobs.changed', jobs));
    this.settings = new SettingsService(options.store, (settings) => options.emit('settings.changed', settings));
    this.projects = new ProjectService({ home: options.home, media: options.media, onChanged: (session) => options.emit('project.changed', session), onProgress: (projectId, completed, total, rel) => options.emit('media.progress', { projectId, rel, stage: 'import', progress: completed / Math.max(1, total) }) });
    this.urls = new UrlImportService({ runtime: this, media: options.media, resolveTool: options.resolveTool });
    this.elevenlabs = new ElevenLabsClient({ key: () => options.secrets.get('elevenlabs'), connected: () => options.store.get().accounts.elevenlabs.status === 'connected' });
    this.audio = new AudioService({ runtime: this, client: this.elevenlabs, media: options.media, resolveTool: options.resolveTool });
    this.transcripts = new TranscriptsService({ runtime: this, home: options.home, client: this.elevenlabs, resolveTool: options.resolveTool, resolveModel: options.resolveModel });
    this.overlays = new OverlayService({ runtime: this, compositionsRoot: options.compositionsRoot, resolveTool: options.resolveTool });
    this.exports = new ExportService(this, options.media, options.resolveTool);
    this.skills = new SkillsService({ home: options.home, builtinRoot: options.skillsRoot, baseUrl: options.compositionBaseUrl, current: () => this.projects.require(), changed: (skills) => options.emit('skills.changed', skills) });
    this.compositions = new CompositionsService({ root: options.compositionsRoot, baseUrl: options.compositionBaseUrl, current: () => this.projects.require(), skillRoot: (id) => this.skills.root(id) });
    this.agent = new AgentService({ runtime: this, media: options.media, secrets: options.secrets, emit: (event) => options.emit('agent.event', event) });
    this.extensions = new ExtensionsService({ store: options.store, secrets: options.secrets, changed: () => options.emit('settings.changed', options.store.get()), status: async (id) => {
      const connected = this.agent.extensionStatus(id); if (connected) return connected;
      if (id === 'cutroom') return { status: 'ready', detail: 'Built-in editor tools are ready.' };
      if (id === 'codex') { try { const status = await this.codex.status(); return { status: status.available && status.loggedIn ? 'ready' : 'unavailable', detail: !status.available ? 'Codex CLI not found' : !status.loggedIn ? 'Sign in to Codex in Accounts first.' : 'Ready for the next assistant session.' }; } catch { return { status: 'unavailable', detail: 'Could not check Codex CLI sign-in.' }; } }
      if (id === 'elevenlabs') return { status: options.store.get().accounts.elevenlabs.status === 'connected' ? 'ready' : 'unavailable', detail: options.store.get().accounts.elevenlabs.status === 'connected' ? 'Ready for the next assistant session.' : 'Connect ElevenLabs in Settings → Accounts.' };
      return { status: 'unavailable', detail: 'Starts with the next edit session. Remote servers may require authorization.' };
    } });
    this.storage = new StorageService({ home: options.home, current: () => this.projects.current(), newestSnapshot: async () => (await this.activeTimeline?.snapshots())?.[0]?.id, busy: () => this.jobs.list().some((job) => job.status === 'running' || job.status === 'queued') });
    this.projects.onChanged(async (session) => {
      const next = session ? await TimelineService.load(session.rootPath, { snapshotPolicy: () => options.store.get().snapshots, sourceDurations: () => options.media.sourceDurations(), onChanged: (change) => {
        this.agent.record(change);
        options.emit('timeline.changed', { revision: change.revision, doc: change.doc, actor: change.actor, label: change.label, ...(change.requestId ? { requestId: change.requestId } : {}) });
      } }) : null;
      const current = this.projects.current(); if (current) { await this.agent.close(); await this.jobs.cancelProject(current.project.id); }
      await this.activeTimeline?.close(); this.activeTimeline = next;
    });
  }
  timeline(): TimelineService { if (!this.activeTimeline) throw new IpcFailure({ code: 'not_found', message: 'Open or create a project first.' }); if (this.projects.current()?.rootPath !== this.activeTimeline.root) throw new IpcFailure({ code: 'conflict', message: 'The project is switching. Retry in the current project.' }); return this.activeTimeline; }
  async close(): Promise<void> { await this.agent.close(); await this.transcripts.close(); await this.jobs.close(); await this.projects.close(); this.projects.grants.clear(); }
}
