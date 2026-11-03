import type { InvokeChannel, InvokeReq } from '@shared/ipc/contract';

const format = { aspect: '16:9', width: 1920, height: 1080, fps: 30 } as const;
const creation = { name: 'Example', format, defaultEngine: 'hyperframes' } as const;
const extension = { id: 'example', name: 'Example', transport: 'stdio', command: 'example', args: [], enabled: false } as const;
export const scaffoldRequests = {
  'dialog.pickFolder': { purpose: 'projectParent' },
  'project.create': { ...creation, parentGrant: 'grant' },
  'project.retryFootageImport': { retryId: 'retry' },
  'project.open': { grantId: 'grant' }, 'project.createInPlace': { ...creation, grantId: 'grant' },
  'project.current': {}, 'project.close': {}, 'project.listRecent': {}, 'project.removeRecent': { id: 'recent' },
  'project.adoptLooseMedia': { rels: ['raw/example.mp4'] },
  'timeline.get': {}, 'timeline.apply': { ops: [{ type: 'setFormat', format: { fps: 30 } }], label: 'Set format', baseRevision: 0 },
  'timeline.undo': {}, 'timeline.redo': {}, 'timeline.history': {},
  'jobs.list': {}, 'jobs.cancel': { id: 'job' }, 'export.presets': {}, 'export.preflight': { presetId: 'draft' },
  'export.start': { presetId: 'draft', acknowledgeUnsupported: false }, 'shell.openInProject': { rel: 'final/example.mp4' },
  'settings.get': {}, 'settings.update': { patch: { appearance: 'dark' } }, 'storage.usage': {},
  'storage.cleanPreview': { categories: ['thumbnails'] }, 'storage.clean': { token: 'token' },
  'snapshots.list': {}, 'snapshots.create': { label: 'Snapshot' }, 'snapshots.restore': { id: 'snapshot' }, 'snapshots.delete': { id: 'snapshot' },
  'transcripts.get': { rel: 'raw/example.mp4' }, 'transcripts.start': { rel: 'raw/example.mp4', engine: 'whisper' },
  'captions.generate': { clipItemId: 'clip_abcdefghij' },
  'voice.transcribe': { audio: new Uint8Array([1, 2]), mime: 'audio/wav', engine: 'whisper' },
  'urlImport.fetch': { url: 'https://youtube.com/watch?v=example' },
  'urlImport.download': { url: 'https://youtube.com/watch?v=example', formatId: 'best', destination: 'raw', rightsConfirmed: true },
  'compositions.templates': {}, 'compositions.list': {}, 'compositions.create': { template: 'lower-third', name: 'example' },
  'compositions.check': { name: 'example' }, 'compositions.render': { itemId: 'composition_abcdefghij' },
  'agent.sessions.list': {}, 'agent.start': { mode: 'edit' }, 'agent.send': { sessionId: 'session', text: 'Hello' },
  'agent.interrupt': { sessionId: 'session' }, 'agent.respondPermission': { requestId: 'permission', allow: false },
  'agent.review.keep': { requestId: 'review' }, 'agent.review.revert': { requestId: 'review' },
  'accounts.codex.status': {}, 'accounts.codex.openLogin': {},
  'audio.voices': {}, 'audio.estimate': { kind: 'tts', text: 'Hello' }, 'audio.generate': { kind: 'tts', text: 'Hello', voiceId: 'voice' },
  'extensions.list': {}, 'extensions.validate': { config: { ...extension, args: [] } },
  'extensions.add': { config: { ...extension, args: [] } }, 'extensions.remove': { id: 'example' }, 'extensions.setEnabled': { id: 'example', enabled: false },
} satisfies Partial<{ [C in InvokeChannel]: InvokeReq<C> }>;
