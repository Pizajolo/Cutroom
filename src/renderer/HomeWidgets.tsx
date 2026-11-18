import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Film,
  FolderOpen,
  GripVertical,
  LayoutDashboard,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { PLATFORMS } from '../shared/social';
import type { ExportedVideo, SocialSettings, SocialStatus } from '../shared/social';
import type { Brain, MarketSkill, Project, Skill } from '../shared/types';
import { BestVideo, Tile, compact, ownAccounts, period, summarize, videoName } from './socialStats';
import type { SocialSummary } from './socialStats';
import { api } from './lib';

export type Page =
  'Home' | 'Projects' | 'Social' | 'Library' | 'Marketplace' | 'Features' | 'Settings';

type Size = 'S' | 'M' | 'L';
type WidgetId =
  | 'projects'
  | 'followers'
  | 'views'
  | 'likes'
  | 'best'
  | 'drafts'
  | 'top'
  | 'market'
  | 'library'
  | 'start';
interface Placed {
  id: WidgetId;
  size: Size;
}

/** Every widget, the sizes its content works at, and the size it gets when added. */
const WIDGETS: Record<WidgetId, { title: string; sizes: Size[]; size: Size }> = {
  projects: { title: 'Continue editing', sizes: ['M', 'L'], size: 'L' },
  followers: { title: 'Followers', sizes: ['S', 'M'], size: 'S' },
  views: { title: 'Video views', sizes: ['S', 'M'], size: 'S' },
  likes: { title: 'Likes', sizes: ['S', 'M'], size: 'S' },
  best: { title: 'Best video this week', sizes: ['S', 'M'], size: 'S' },
  drafts: { title: 'Ready to post', sizes: ['M', 'L'], size: 'M' },
  top: { title: 'Top videos this week', sizes: ['M', 'L'], size: 'M' },
  market: { title: 'From the marketplace', sizes: ['M', 'L'], size: 'M' },
  library: { title: 'Library', sizes: ['S', 'M'], size: 'S' },
  start: { title: 'Getting started', sizes: ['M', 'L'], size: 'M' },
};
const DEFAULT: Placed[] = [
  { id: 'start', size: 'L' },
  { id: 'projects', size: 'L' },
  { id: 'followers', size: 'S' },
  { id: 'views', size: 'S' },
  { id: 'likes', size: 'S' },
  { id: 'best', size: 'S' },
  { id: 'drafts', size: 'M' },
  { id: 'top', size: 'M' },
];
/** The social numbers: with no account connected they show as one Connect prompt. */
const STATS: WidgetId[] = ['followers', 'views', 'likes', 'best'];
const SIZE_NAMES: Record<Size, string> = { S: 'Small', M: 'Medium', L: 'Large' };
const STORE = 'home-layout';

/** The layout saved on this Mac, or the default. Unknown widgets and sizes are dropped. */
function loadLayout(): Placed[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Placed[] | null;
    if (Array.isArray(saved)) {
      return saved.filter(
        (w, i) =>
          w &&
          w.id in WIDGETS &&
          WIDGETS[w.id].sizes.includes(w.size) &&
          saved.findIndex((x) => x.id === w.id) === i,
      );
    }
  } catch {
    // Storage unavailable or broken: use the default.
  }
  return DEFAULT;
}
function saveLayout(layout: Placed[] | null): void {
  try {
    if (layout) localStorage.setItem(STORE, JSON.stringify(layout));
    else localStorage.removeItem(STORE);
  } catch {
    // Not kept, but it still works for now.
  }
}

const ago = (iso: string): string => {
  const hours = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.floor(hours)} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1
    ? 'yesterday'
    : days < 30
      ? `${days} days ago`
      : new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
};

interface Data {
  projects: Project[];
  exports: ExportedVideo[];
  social: SocialStatus | null;
  summary: SocialSummary | null;
  skills: Skill[];
  brain: Brain | null;
  market: MarketSkill[] | null;
  marketError: boolean;
}

/** Home: widgets the user can resize, reorder, remove and add. */
export function Dashboard({
  projects,
  social,
  rules,
  onOpenProject,
  onNewProject,
  onGo,
  onGuide,
  onMarket,
}: {
  projects: Project[];
  social: SocialStatus | null;
  rules: SocialSettings | null;
  onOpenProject: (project: Project) => void;
  onNewProject: () => void;
  onGo: (page: Page) => void;
  onGuide: () => void;
  onMarket: (slug: string) => void;
}) {
  const [layout, setLayout] = useState<Placed[]>(loadLayout);
  const [editing, setEditing] = useState(false);
  const [exports, setExports] = useState<ExportedVideo[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [brain, setBrain] = useState<Brain | null>(null);
  const [market, setMarket] = useState<MarketSkill[] | null>(null);
  const [marketError, setMarketError] = useState(false);
  const [checking, setChecking] = useState('');
  const dragged = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  useEffect(() => {
    void api.socialExports().then(setExports, () => {});
    void api.listSkills().then(setSkills, () => {});
    void api.brain().then(setBrain, () => {});
  }, []);
  const wantsMarket = layout.some((w) => w.id === 'market');
  useEffect(() => {
    if (!wantsMarket || market) return;
    void api.marketBrowse({ sort: 'popular' }).then(
      (page) => setMarket(page.skills),
      () => setMarketError(true),
    );
  }, [wantsMarket, market]);

  const change = (next: Placed[]): void => {
    setLayout(next);
    saveLayout(next);
  };
  const move = (from: number, to: number): void => {
    if (from === to || to < 0 || to >= layout.length) return;
    const next = [...layout];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    change(next);
  };

  const summary = social && rules ? summarize(social, ownAccounts(rules)) : null;
  const data: Data = { projects, exports, social, summary, skills, brain, market, marketError };
  const steps = startSteps(data);
  const startDone = steps.every((s) => s.done);
  // Getting started leaves by itself once everything in it is done (it stays listed while customizing).
  const shown = layout.filter((w) => editing || w.id !== 'start' || !startDone);
  const available = (Object.keys(WIDGETS) as WidgetId[]).filter(
    (id) => !layout.some((w) => w.id === id),
  );

  const checkNow = (): void => {
    setChecking('…');
    void api.socialCheckNow().then(
      () => setChecking(''),
      (e: Error) =>
        setChecking(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')),
    );
  };

  const content = (w: Placed): React.ReactNode => {
    switch (w.id) {
      case 'projects':
        return (
          <ProjectsWidget
            size={w.size}
            data={data}
            onOpen={onOpenProject}
            onNew={onNewProject}
            onAll={() => onGo('Projects')}
          />
        );
      case 'followers':
      case 'views':
      case 'likes': {
        const label = WIDGETS[w.id].title;
        if (!summary?.connected)
          return (
            <SocialPrompt
              label={label}
              text="Not connected"
              action="Connect"
              onClick={() => onGo('Social')}
            />
          );
        if (!summary.counted)
          return (
            <SocialPrompt
              label={label}
              text={checking && checking !== '…' ? checking : 'Nothing counted yet'}
              action={checking === '…' ? 'Checking…' : 'Check now'}
              onClick={checkNow}
              busy={checking === '…' || !!social?.checking}
            />
          );
        return <Tile label={label} figure={summary[w.id]} />;
      }
      case 'best':
        if (!summary?.connected)
          return (
            <SocialPrompt
              label="Best video this week"
              text="Not connected"
              action="Connect"
              onClick={() => onGo('Social')}
            />
          );
        return <BestVideo summary={summary} />;
      case 'drafts':
        return <DraftsWidget size={w.size} social={social} onSocial={() => onGo('Social')} />;
      case 'top':
        return <TopWidget size={w.size} summary={summary} onSocial={() => onGo('Social')} />;
      case 'market':
        return (
          <MarketWidget
            size={w.size}
            data={data}
            onOpen={onMarket}
            onAll={() => onGo('Marketplace')}
          />
        );
      case 'library':
        return <LibraryWidget skills={skills} onOpen={() => onGo('Library')} />;
      case 'start':
        return <StartWidget steps={steps} onGuide={onGuide} onGo={onGo} onNew={onNewProject} />;
    }
  };

  return (
    <div className="dashboard">
      <div className="row page-title">
        <h1>Home</h1>
        <span className="spacer" />
        {editing ? (
          <>
            <button
              className="ghost"
              onClick={() => change(DEFAULT)}
              title="Back to the standard widgets"
            >
              Reset to default
            </button>
            <button className="primary" onClick={() => setEditing(false)}>
              <Check size={14} /> Done
            </button>
          </>
        ) : (
          <>
            <button
              className="ghost"
              onClick={() => setEditing(true)}
              title="Resize, reorder, remove or add widgets"
            >
              <LayoutDashboard size={14} /> Customize
            </button>
            <button className="primary" onClick={onNewProject}>
              <FolderOpen size={14} /> Open or create a project
            </button>
          </>
        )}
      </div>

      {editing && (
        <p className="banner">
          <GripVertical size={14} /> Drag widgets to reorder them (or use the arrows), pick a size,
          or remove them. Add more below. Saved on this Mac.
        </p>
      )}

      <div className={editing ? 'widgets editing' : 'widgets'}>
        {shown.map((w) => {
          const i = layout.indexOf(w);
          const spec = WIDGETS[w.id];
          // Not connected yet: the social numbers make way for one prompt, where the first of them is.
          if (!editing && summary && !summary.connected && STATS.includes(w.id)) {
            if (shown.find((x) => STATS.includes(x.id)) !== w) return null;
            return (
              <section key="connect" className="widget w-L" aria-label="Connect your accounts">
                <div className="widget-body connect-widget">
                  <div className="grow">
                    <h2>See how your videos do</h2>
                    <span className="hint">
                      Connect TikTok or Instagram: Cutroom counts your followers, likes and the
                      views of every video, and Claude tells you what works.
                    </span>
                  </div>
                  <button className="primary" onClick={() => onGo('Social')}>
                    Connect an account
                  </button>
                </div>
              </section>
            );
          }
          return (
            <section
              key={w.id}
              className={`widget w-${w.size}${over === i && dragged.current !== i ? ' drop' : ''}`}
              aria-label={spec.title}
              draggable={editing}
              onDragStart={(e) => {
                dragged.current = i;
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (dragged.current === null) return;
                e.preventDefault();
                setOver(i);
              }}
              onDragLeave={() => setOver((now) => (now === i ? null : now))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragged.current !== null) move(dragged.current, i);
                dragged.current = null;
                setOver(null);
              }}
              onDragEnd={() => {
                dragged.current = null;
                setOver(null);
              }}
            >
              {editing && (
                <div className="widget-tools">
                  <GripVertical size={14} className="handle" aria-hidden />
                  <span className="spacer" />
                  {spec.sizes.length > 1 && (
                    <div className="sizes" role="group" aria-label={`Size of ${spec.title}`}>
                      {spec.sizes.map((s) => (
                        <button
                          key={s}
                          aria-pressed={w.size === s}
                          title={SIZE_NAMES[s]}
                          onClick={() =>
                            change(layout.map((x) => (x.id === w.id ? { ...x, size: s } : x)))
                          }
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    className="ghost icon"
                    aria-label={`Move ${spec.title} earlier`}
                    disabled={i === 0}
                    onClick={() => move(i, i - 1)}
                  >
                    <ArrowLeft size={14} />
                  </button>
                  <button
                    className="ghost icon"
                    aria-label={`Move ${spec.title} later`}
                    disabled={i === layout.length - 1}
                    onClick={() => move(i, i + 1)}
                  >
                    <ArrowRight size={14} />
                  </button>
                  <button
                    className="ghost icon"
                    aria-label={`Remove ${spec.title}`}
                    onClick={() => change(layout.filter((x) => x.id !== w.id))}
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
              <div className="widget-body">{content(w)}</div>
            </section>
          );
        })}
        {!shown.length && (
          <p className="hint">Nothing on your home page. Press Customize to add widgets.</p>
        )}
      </div>

      {editing && (
        <section className="tray" aria-label="Add widgets">
          <div className="row">
            <h2>Add widgets</h2>
            <span className="hint">
              {available.length
                ? `${available.length} more available`
                : 'Everything is on your home page'}
            </span>
          </div>
          <div className="catalog">
            {available.map((id) => (
              <div className="option" key={id}>
                <span className="grow">
                  <strong>{WIDGETS[id].title}</strong>
                  <span className="hint">
                    {' '}
                    · {WIDGETS[id].sizes.map((s) => SIZE_NAMES[s]).join(', ')}
                  </span>
                </span>
                <button onClick={() => change([...layout, { id, size: WIDGETS[id].size }])}>
                  <Plus size={14} /> Add
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// --- The widgets ------------------------------------------------------------------------------------

function WidgetHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="row widget-head">
      <h2>{title}</h2>
      <span className="spacer" />
      {children}
    </div>
  );
}

function ProjectsWidget({
  size,
  data,
  onOpen,
  onNew,
  onAll,
}: {
  size: Size;
  data: Data;
  onOpen: (p: Project) => void;
  onNew: () => void;
  onAll: () => void;
}) {
  const shown = data.projects.slice(0, size === 'L' ? 4 : 2);
  return (
    <>
      <WidgetHead title="Continue editing">
        {data.projects.length > shown.length && (
          <button className="link" onClick={onAll}>
            All {data.projects.length} projects
          </button>
        )}
      </WidgetHead>
      {shown.length ? (
        <div className={`thumbs n${size === 'L' ? 4 : 2}`}>
          {shown.map((p) => {
            const last = data.exports.find((e) => e.path.startsWith(`${p.root}/`));
            return (
              <button
                key={p.root}
                className="project-card"
                onClick={() => onOpen(p)}
                title={p.root}
              >
                <span className={last ? 'thumb' : 'thumb blank'}>
                  {last ? (
                    <video
                      src={`media://post${encodeURI(last.path)}#t=1`}
                      muted
                      preload="metadata"
                    />
                  ) : (
                    <Film size={22} />
                  )}
                </span>
                <span className="meta">
                  <strong>{p.name}</strong>
                  <span className="hint">
                    {last ? `Last export ${ago(last.at)}` : p.root.replace(/^\/Users\/[^/]+/, '~')}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="empty">
          <span className="hint">A project is a folder with your raw footage.</span>
          <button className="primary" onClick={onNew}>
            <FolderOpen size={14} /> Open or create a folder
          </button>
        </div>
      )}
    </>
  );
}

function SocialPrompt({
  label,
  text,
  action,
  onClick,
  busy,
}: {
  label: string;
  text: string;
  action: string;
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <div className="tile">
      <span className="label">{label}</span>
      <strong className="value muted">—</strong>
      <span className="delta hint">{text}</span>
      <button className="fit" disabled={busy} onClick={onClick}>
        {action === 'Check now' || action === 'Checking…' ? <RefreshCw size={14} /> : null} {action}
      </button>
    </div>
  );
}

function DraftsWidget({
  size,
  social,
  onSocial,
}: {
  size: Size;
  social: SocialStatus | null;
  onSocial: () => void;
}) {
  const ready = (social?.drafts ?? []).filter(
    (d) => d.status === 'draft' || d.status === 'waiting',
  );
  return (
    <>
      <WidgetHead title="Ready to post">
        {ready.length > 0 && (
          <span className="tag warn">
            {ready.length} draft{ready.length === 1 ? '' : 's'}
          </span>
        )}
      </WidgetHead>
      {ready.length ? (
        <ul className="rows">
          {ready.slice(0, size === 'L' ? 6 : 3).map((d) => (
            <li key={d.id}>
              <span className="tag">{PLATFORMS[d.platform].label}</span>
              <span className="grow ellipsis" title={d.caption}>
                <strong>{d.video.split('/').pop()}</strong> {d.caption.split('\n')[0]}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">
          Nothing waiting. Ask Claude in Social for a caption for an exported video.
        </p>
      )}
      <button className="fit" onClick={onSocial}>
        {ready.length ? 'Review and post' : 'Open Social'}
      </button>
    </>
  );
}

function TopWidget({
  size,
  summary,
  onSocial,
}: {
  size: Size;
  summary: SocialSummary | null;
  onSocial: () => void;
}) {
  const top = summary?.top.slice(0, size === 'L' ? 6 : 3) ?? [];
  return (
    <>
      <WidgetHead title="Top videos this week">
        {summary?.connected && (
          <button className="link" onClick={onSocial}>
            All videos
          </button>
        )}
      </WidgetHead>
      {top.length ? (
        <ul className="rows">
          {top.map((v) => (
            <li key={`${v.platform}:${v.id}`}>
              <span className="tag">{PLATFORMS[v.platform].label}</span>
              <span className="grow ellipsis" title={v.caption ?? v.url}>
                {videoName(v)}
              </span>
              <span className="num" title={`New views ${period(v.since7d)}`}>
                +{compact(v.views7d!)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">
          {summary?.connected
            ? 'Shows up after two stat checks a few days apart.'
            : 'Connect TikTok or Instagram to see how your videos do.'}
        </p>
      )}
    </>
  );
}

function MarketWidget({
  size,
  data,
  onOpen,
  onAll,
}: {
  size: Size;
  data: Data;
  onOpen: (slug: string) => void;
  onAll: () => void;
}) {
  const picks = data.market?.slice(0, size === 'L' ? 6 : 3) ?? [];
  return (
    <>
      <WidgetHead title="From the marketplace">
        <button className="link" onClick={onAll}>
          Browse
        </button>
      </WidgetHead>
      {data.marketError ? (
        <p className="hint">The marketplace can’t be reached right now.</p>
      ) : !data.market ? (
        <p className="hint">Loading…</p>
      ) : (
        <ul className="rows">
          {picks.map((s) => (
            <li key={s.slug}>
              <button className="ghost row-button" onClick={() => onOpen(s.slug)}>
                <span className="tag">{s.kind === 'move' ? 'Move' : 'Style'}</span>
                <span className="grow ellipsis" title={s.description}>
                  {s.name}
                </span>
                {s.stats.ratings > 0 && <span className="hint">★ {s.stats.rating.toFixed(1)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function LibraryWidget({ skills, onOpen }: { skills: Skill[]; onOpen: () => void }) {
  const favorites = skills.filter((s) => s.favorite).length;
  return (
    <div className="tile">
      <span className="label">Library</span>
      <strong className="value">{skills.length}</strong>
      <span className="delta hint">
        styles and moves{favorites ? ` · ${favorites} favourite${favorites === 1 ? '' : 's'}` : ''}
      </span>
      <button className="fit" onClick={onOpen}>
        Open library
      </button>
    </div>
  );
}

interface Step {
  label: string;
  done: boolean;
  action: string;
  run: () => void;
}

function startSteps(data: Data): (Omit<Step, 'run'> & { go: 'guide' | 'new' | Page })[] {
  return [
    { label: 'Connect a model', done: !!data.brain?.any, action: 'Open the guide', go: 'guide' },
    {
      label: 'Open your first project',
      done: data.projects.length > 0,
      action: 'Open a folder',
      go: 'new',
    },
    {
      label: 'Connect TikTok or Instagram',
      done: !!data.summary?.connected,
      action: 'Connect',
      go: 'Social',
    },
  ];
}

function StartWidget({
  steps,
  onGuide,
  onGo,
  onNew,
}: {
  steps: ReturnType<typeof startSteps>;
  onGuide: () => void;
  onGo: (p: Page) => void;
  onNew: () => void;
}) {
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  return (
    <>
      <WidgetHead title="Getting started">
        <span className="hint">
          {done} of {steps.length} done
        </span>
      </WidgetHead>
      <ul className="rows">
        {steps.map((s) => (
          <li key={s.label}>
            <span className={s.done ? 'tag ok' : 'tag'}>
              {s.done ? 'Done' : s === next ? 'Next' : 'Later'}
            </span>
            <span className="grow">{s.label}</span>
            {!s.done && (
              <button
                onClick={() =>
                  s.go === 'guide' ? onGuide() : s.go === 'new' ? onNew() : onGo(s.go)
                }
              >
                {s.action}
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
