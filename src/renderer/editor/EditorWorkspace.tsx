import { useState, type CSSProperties } from 'react';
import { Film, Import, LockKeyhole, Shield, SlidersHorizontal } from 'lucide-react';
import type { ProjectDoc } from '@shared/schema/project';
import { Tabs } from '../components/Tabs';
import { useNavigation } from '../state/navigation';
import { Timeline } from './timeline/Timeline';
import { useAccounts } from '../lib/useAccounts';
import { ScrubBar, Transport } from './preview/Transport';

const DOCK_TABS = ['Inspector', 'Audio', 'Assistant'] as const;
export function EditorWorkspace({ project }: { project: ProjectDoc }) {
  const [safeAreas, setSafeAreas] = useState(false);
  const [dock, setDock] = useState<typeof DOCK_TABS[number]>('Inspector');
  const focusGoal = useNavigation((state) => state.focusGoal);
  const { data: accounts } = useAccounts();
  const elevenlabsConnected = accounts?.some((account) => account.provider === 'elevenlabs' && account.status === 'connected');
  return <div className="editor-workspace">
    <div className="editor-upper">
      <aside className="media-bin" aria-label="Media bin" data-workspace-region tabIndex={-1}>
        <div className="panel-heading"><h2>Media</h2><button type="button" className="icon-button" aria-label="Import files unavailable" title="File import requires an open project connection" disabled><Import size={16} /></button></div>
        <div className="bin-empty"><Film size={28} strokeWidth={1.5} /><h3>Your project media</h3><p>Media will appear here when the project connection is available.</p><p className="source-guarantee"><LockKeyhole size={14} />Sources are read-only for agents.</p></div>
      </aside>
      <section className="preview-panel" aria-label="Preview" data-workspace-region tabIndex={-1}>
        <div className="panel-heading"><h2>Preview</h2><span className="quiet">{project.format.width} × {project.format.height} · {project.format.fps} fps</span>
          <button type="button" className="icon-button" aria-label="Safe-area guides" aria-pressed={safeAreas} title="Show 90% action-safe and 80% title-safe guides" onClick={() => setSafeAreas(!safeAreas)}><Shield size={16} /></button>
        </div>
        <div className="preview-mat"><div className="preview-canvas" style={{ '--canvas-aspect': project.format.width / project.format.height } as CSSProperties}>
          <div className="preview-empty"><Film size={32} strokeWidth={1.25} /><h2>Timeline not connected</h2><p>Your footage and edit will appear here once the project connection is available.</p><button type="button" className="button" onClick={focusGoal}>Describe your video</button></div>
          {safeAreas && <div className="safe-guides" aria-label="Action-safe and title-safe guides"><div className="action-safe" /><div className="title-safe" /></div>}
        </div></div>
        <ScrubBar /><Transport />
      </section>
      <aside className="inspector-dock" aria-label="Editor tools" data-workspace-region tabIndex={-1}>
        <Tabs label="Editor tools" tabs={DOCK_TABS} value={dock} onChange={setDock}>
          {dock === 'Inspector' ? <div className="inspector-content"><div className="panel-heading"><SlidersHorizontal size={16} /><h2>Project</h2></div>
            <dl className="property-list"><div><dt>Format</dt><dd>{project.format.aspect}</dd></div><div><dt>Resolution</dt><dd>{project.format.width} × {project.format.height}</dd></div><div><dt>Frame rate</dt><dd>{project.format.fps} fps</dd></div><div><dt>Motion engine</dt><dd>{project.defaultEngine === 'hyperframes' ? 'HyperFrames' : 'Remotion'}</dd></div></dl>
            <p className="field-note">Select a clip or an element to see its editable properties.</p>
          </div> : <div className="dock-placeholder"><h3>{dock === 'Audio' ? 'Make the soundtrack' : 'Work with your team'}</h3>{dock === 'Audio' ? elevenlabsConnected ? <p>ElevenLabs connected. Audio generation arrives in a later update.</p> : <><p>Connect ElevenLabs for voice and audio services.</p><button type="button" className="button" onClick={() => { useNavigation.getState().setSettingsSection('Accounts'); useNavigation.getState().navigate('settings'); }}>Connect ElevenLabs</button></> : <p>Ask, live chat and reviewable agent changes will appear here. Agent sessions are not connected in this build.</p>}</div>}
        </Tabs>
      </aside>
    </div>
    <Timeline doc={null} />
    <footer className="editor-status"><span>Project opened · timeline service unavailable</span><span>Sources remain unchanged</span></footer>
  </div>;
}
