import { useEffect, useState } from 'react';
import {
  BarChart3,
  ExternalLink,
  KeyRound,
  LogIn,
  LogOut,
  RefreshCw,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  AUTO_CHECKS,
  PACES,
  PAGE_KINDS,
  PLATFORMS,
  SOCIAL_PLATFORMS,
  cleanHandle,
} from '../shared/social';
import type {
  AutoCheck,
  Pace,
  SocialPlatform,
  SocialSettings,
  SocialSnapshot,
  SocialStatus,
} from '../shared/social';
import { SocialChat } from './SocialChat';
import type { Settings } from '../shared/types';
import { api } from './lib';

const clean = (error: Error): string =>
  error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const when = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const count = (n?: number): string => (n === undefined ? '—' : n.toLocaleString());

/** What the user agrees to before anything reaches TikTok or Instagram. Also shown, shorter, while it is on. */
function Risks() {
  return (
    <ul className="risks">
      <li>
        <strong>It breaks the platforms’ terms.</strong> TikTok and Instagram do not allow automated
        access, even to your own account. Cutroom is not affiliated with either.
      </li>
      <li>
        <strong>Your account carries the risk.</strong> They may show captchas, ask you to sign in
        again, limit or suspend the account. Don’t use an account you can’t afford to lose.
      </li>
      <li>
        <strong>Slow is safer.</strong> Keep the pace careful and the limits low, check your own
        stats at most once a day, and look at a few competitors rather than many.
      </li>
      <li>
        <strong>What Claude reads is sent to your model provider,</strong> like the rest of the
        chat. Claude can’t open messages, settings or feeds, and can’t follow, like, comment or
        post.
      </li>
      <li>
        <strong>Posting goes through the same window.</strong> Claude only drafts captions; nothing
        is posted until you press Post on a draft and confirm it.
      </li>
      <li>
        <strong>Competitors’ data is theirs.</strong> Use it for your own analysis; don’t republish
        it.
      </li>
      <li>
        <strong>Your login stays on this Mac.</strong> If you save one, it is encrypted with your
        macOS Keychain and only typed into the platform’s own sign-in page. It never goes to Claude
        or to Cutroom’s servers.
      </li>
    </ul>
  );
}

/** Followers now, and the change since the earliest count in the last `days` days. */
function growth(rows: SocialSnapshot[], days: number): number | undefined {
  const latest = rows.at(-1);
  if (latest?.followers === undefined) return undefined;
  const since = Date.parse(latest.at) - days * 86_400_000;
  const base = rows.find(
    (r) => Date.parse(r.at) >= since && r.followers !== undefined && r !== latest,
  );
  return base ? latest.followers - base.followers! : undefined;
}
const signed = (n?: number): string =>
  n === undefined ? '—' : `${n > 0 ? '+' : ''}${n.toLocaleString()}`;

/** Home › Social: sign in, decide how Claude may use the accounts, and see what it opened and what it counted. */
export function Social() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<SocialSettings | null>(null);
  const [status, setStatus] = useState<SocialStatus | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [logins, setLogins] = useState<
    Record<SocialPlatform, { username: string; password: string }>
  >({ tiktok: { username: '', password: '' }, instagram: { username: '', password: '' } });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [view, setView] = useState<'overview' | 'accounts' | 'activity'>('overview');

  useEffect(() => {
    void api.getSettings().then((s) => (setSettings(s), setDraft(s.social)));
    void api.socialStatus().then(setStatus);
    return api.on('social', setStatus);
  }, []);
  if (!settings || !draft || !status) return null;

  /** Run a call to the main process, show its error, and take the status it returns. */
  const run = async (label: string, fn: () => Promise<SocialStatus | void>): Promise<void> => {
    setBusy(label);
    setError('');
    try {
      const next = await fn();
      if (next) setStatus(next);
    } catch (e) {
      setError(clean(e as Error));
    } finally {
      setBusy('');
    }
  };
  const saveRules = async (next: SocialSettings): Promise<void> => {
    // Read the latest settings first, so this never undoes a change made elsewhere.
    const latest = await api.getSettings();
    const merged = { ...latest, social: next };
    await api.saveSettings(merged);
    setSettings(merged);
    setDraft(next);
    setStatus(await api.socialStatus());
  };
  const set = (patch: Partial<SocialSettings>): void => setDraft({ ...draft, ...patch });
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.social);

  if (!status.accepted) {
    return (
      <div className="social">
        <h1>Social</h1>
        <p className="hint">
          Let Claude read your TikTok and Instagram — your own stats (new followers, likes, views)
          and your competitors’ public profiles — and draft captions for your exported videos, which
          you post with one click. It works in a browser window inside Cutroom that you sign in to
          yourself, so no app approval or API is needed.
        </p>
        <section className="warning" role="alert">
          <h2>
            <TriangleAlert size={16} /> Read this first
          </h2>
          <Risks />
          <label className="choice">
            <input
              type="checkbox"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
            />
            I understand the risks and use this on my own accounts at my own responsibility.
          </label>
          <div className="fields">
            <button
              className="primary"
              disabled={!understood}
              onClick={() =>
                void run('accept', () =>
                  saveRules({ ...draft, accepted: new Date().toISOString() }),
                )
              }
            >
              Turn on social analytics
            </button>
          </div>
        </section>
        {error && <p className="note error">{error}</p>}
      </div>
    );
  }

  // Counts per account, oldest first.
  const accounts = new Map<string, SocialSnapshot[]>();
  for (const s of status.snapshots)
    accounts.set(`${s.platform}:${s.handle}`, [
      ...(accounts.get(`${s.platform}:${s.handle}`) ?? []),
      s,
    ]);
  const ownFirst = [...accounts.entries()].sort(([a], [b]) => {
    const own = (key: string): number =>
      SOCIAL_PLATFORMS.some((p) => key === `${p}:${cleanHandle(draft.handles[p])}`) ? 0 : 1;
    return own(a) - own(b) || a.localeCompare(b);
  });

  return (
    <div className="social wide">
      <div className="row">
        <h1>Social</h1>
        <div className="switch" role="tablist" aria-label="Social">
          {(
            [
              ['overview', 'Overview'],
              ['accounts', 'Accounts & rules'],
              ['activity', 'Activity'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)}>
              {label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <span
          className="tag"
          title="Each page Claude or the automatic check opens, clicks or scrolls counts"
        >
          {status.today} of {settings.social.perDay} page views today
        </span>
        <button
          disabled={!!busy || status.checking}
          title="Open your own profiles now and note followers, following and likes"
          onClick={() => void run('check', api.socialCheckNow)}
        >
          <RefreshCw size={14} /> {status.checking ? 'Checking…' : 'Check my stats now'}
        </button>
      </div>

      <details className="warning compact">
        <summary>
          <TriangleAlert size={14} /> Automated access breaks TikTok’s and Instagram’s terms and can
          get an account limited or suspended. Keep it slow.
        </summary>
        <Risks />
        <div className="fields">
          <button
            onClick={() =>
              void run('off', () => saveRules({ ...settings.social, accepted: undefined }))
            }
          >
            Turn social analytics off
          </button>
        </div>
      </details>
      {error && <p className="note error">{error}</p>}

      {view === 'accounts' && (
        <>
          <section>
            <h2>Accounts</h2>
            <p className="hint">
              Sign in once in the Social window; Cutroom keeps the session, encrypted with your
              Keychain, so it survives a restart. Save your login too and Cutroom signs in again by
              itself when the session runs out. Two-factor codes and captchas you answer yourself in
              the window.
            </p>
            {SOCIAL_PLATFORMS.map((p) => {
              const state = status.platforms[p];
              const login = logins[p];
              return (
                <div className="account" key={p}>
                  <div className="fields">
                    <strong className="task">{PLATFORMS[p].label}</strong>
                    <span className={state.signedIn ? 'tag ok' : 'tag'}>
                      {state.signedIn ? 'Signed in' : 'Not signed in'}
                    </span>
                    <input
                      placeholder="Your handle, e.g. @mychannel"
                      value={draft.handles[p]}
                      aria-label={`Your ${PLATFORMS[p].label} handle`}
                      onChange={(e) => set({ handles: { ...draft.handles, [p]: e.target.value } })}
                    />
                    <span className="spacer" />
                    {state.signedIn ? (
                      <>
                        <button
                          onClick={() =>
                            void run(`open-${p}`, () => api.socialOpen(p, 'analytics'))
                          }
                        >
                          <BarChart3 size={14} /> Open analytics
                        </button>
                        <button
                          className="ghost"
                          onClick={() =>
                            confirm(`Sign out of ${PLATFORMS[p].label} in Cutroom?`) &&
                            void run(`out-${p}`, () => api.socialSignOut(p))
                          }
                        >
                          <LogOut size={14} /> Sign out
                        </button>
                      </>
                    ) : state.savedLogin ? (
                      <button
                        disabled={!!busy}
                        onClick={() => void run(`in-${p}`, () => api.socialSignIn(p))}
                      >
                        <LogIn size={14} />{' '}
                        {busy === `in-${p}` ? 'Signing in…' : 'Sign in with saved login'}
                      </button>
                    ) : (
                      <button
                        onClick={() => void run(`open-${p}`, () => api.socialOpen(p, 'login'))}
                      >
                        <ExternalLink size={14} /> Sign in…
                      </button>
                    )}
                  </div>
                  {state.savedLogin ? (
                    <div className="fields">
                      <KeyRound size={14} className="muted" />
                      <span className="hint grow">
                        Login for <strong>{state.savedLogin}</strong> saved, encrypted with your
                        Keychain.
                      </span>
                      <button
                        className="ghost"
                        onClick={() => void run(`forget-${p}`, () => api.socialForgetLogin(p))}
                      >
                        <X size={14} /> Forget login
                      </button>
                    </div>
                  ) : (
                    <form
                      className="fields"
                      onSubmit={(e) => (
                        e.preventDefault(),
                        void run(`save-${p}`, async () => {
                          const next = await api.socialSaveLogin(p, login.username, login.password);
                          setLogins({ ...logins, [p]: { username: '', password: '' } });
                          return next;
                        })
                      )}
                    >
                      <KeyRound size={14} className="muted" />
                      <input
                        className="grow"
                        placeholder="User name or email"
                        autoComplete="off"
                        value={login.username}
                        onChange={(e) =>
                          setLogins({ ...logins, [p]: { ...login, username: e.target.value } })
                        }
                      />
                      <input
                        className="grow"
                        type="password"
                        placeholder="Password"
                        autoComplete="off"
                        value={login.password}
                        onChange={(e) =>
                          setLogins({ ...logins, [p]: { ...login, password: e.target.value } })
                        }
                      />
                      <button disabled={!login.username.trim() || !login.password}>
                        Save login in Keychain
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
            {SOCIAL_PLATFORMS.some((p) => draft.handles[p] !== settings.social.handles[p]) && (
              <p className="hint">Save below to keep the handles.</p>
            )}
          </section>

          <form
            className="settings"
            onSubmit={(e) => (e.preventDefault(), void run('save', () => saveRules(draft)))}
          >
            <section>
              <div className="row wide">
                <h2>How Claude may use them</h2>
                <span className="spacer" />
                <button className="primary" disabled={!dirty || !!busy}>
                  Save
                </button>
              </div>
              <p className="hint">
                These rules are enforced by Cutroom, not left to Claude. They apply from the next
                message.
              </p>

              <div className="fields wide">
                <span className="task">Platforms</span>
                {SOCIAL_PLATFORMS.map((p) => (
                  <label className="choice" key={p}>
                    <input
                      type="checkbox"
                      checked={draft.platforms[p]}
                      onChange={(e) =>
                        set({ platforms: { ...draft.platforms, [p]: e.target.checked } })
                      }
                    />
                    {PLATFORMS[p].label}
                  </label>
                ))}
              </div>

              <div className="fields wide top">
                <span className="task">Pages Claude may open</span>
                <div className="options">
                  {(Object.keys(PAGE_KINDS) as (keyof typeof PAGE_KINDS)[]).map((k) => (
                    <label className="choice" key={k}>
                      <input
                        type="checkbox"
                        checked={draft.pages[k]}
                        onChange={(e) => set({ pages: { ...draft.pages, [k]: e.target.checked } })}
                      />
                      {PAGE_KINDS[k].label}
                      <span className="hint">{PAGE_KINDS[k].hint}</span>
                    </label>
                  ))}
                  <p className="hint">
                    Messages, settings, feeds and everything else are always closed to Claude.
                  </p>
                </div>
              </div>

              <div className="fields wide">
                <span className="task">Competitors</span>
                <input
                  className="grow"
                  placeholder="Only these accounts, e.g. @rival1, @rival2 — empty allows any"
                  defaultValue={draft.competitors.map((h) => `@${h}`).join(', ')}
                  key={draft.competitors.join()}
                  onBlur={(e) =>
                    set({
                      competitors: e.target.value
                        .split(/[\s,]+/)
                        .map(cleanHandle)
                        .filter(Boolean),
                    })
                  }
                />
              </div>

              <div className="fields wide">
                <span className="task">Speed</span>
                <select value={draft.pace} onChange={(e) => set({ pace: e.target.value as Pace })}>
                  {(Object.keys(PACES) as Pace[]).map((k) => (
                    <option key={k} value={k}>
                      {PACES[k].label} — {PACES[k].seconds.join('–')} s between pages
                    </option>
                  ))}
                </select>
              </div>

              <div className="fields wide">
                <span className="task">Limits</span>
                <label className="choice">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={draft.perMessage}
                    onChange={(e) => set({ perMessage: Math.max(1, Number(e.target.value) || 1) })}
                  />
                  page views per message
                </label>
                <label className="choice">
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={draft.perDay}
                    onChange={(e) => set({ perDay: Math.max(1, Number(e.target.value) || 1) })}
                  />
                  per day
                </label>
              </div>

              <div className="fields wide">
                <span className="task">Check my stats automatically</span>
                <select
                  value={draft.autoCheck}
                  onChange={(e) => set({ autoCheck: e.target.value as AutoCheck })}
                >
                  {(Object.keys(AUTO_CHECKS) as AutoCheck[]).map((k) => (
                    <option key={k} value={k}>
                      {AUTO_CHECKS[k].label}
                    </option>
                  ))}
                </select>
                <span className="hint grow">
                  While Cutroom is open: opens your own profiles and notes followers, following and
                  likes. Needs your handles.
                </span>
              </div>

              <p className="hint">
                The Social window stays hidden while Claude and the checks work in it. It only comes
                up when something needs you: a sign-in, a code, a captcha or a page that looks
                wrong.
              </p>
            </section>
          </form>
        </>
      )}

      {view === 'overview' && (
        <div className="social-grid">
          <div className="social-main">
            <section>
              <h2>Follower counts</h2>
              <p className="hint">
                From the automatic check, Check my stats now, and counts Claude saved. Claude uses
                them to work out growth.
                {status.lastCheck &&
                  ` Last check: ${when(status.lastCheck.at)}${status.lastCheck.error ? ` — ${status.lastCheck.error}` : ''}.`}
              </p>
              {ownFirst.length ? (
                <table className="stats wide">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Followers</th>
                      <th>Last 24 h</th>
                      <th>Last 7 days</th>
                      <th>Likes</th>
                      <th>Counted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ownFirst.map(([key, rows]) => {
                      const latest = rows.at(-1)!;
                      return (
                        <tr key={key}>
                          <td>
                            {PLATFORMS[latest.platform].label} · @{latest.handle}
                          </td>
                          <td>{count(latest.followers)}</td>
                          <td>{signed(growth(rows, 1))}</td>
                          <td>{signed(growth(rows, 7))}</td>
                          <td>{count(latest.likes)}</td>
                          <td className="hint">
                            {when(latest.at)} · {rows.length} count{rows.length === 1 ? '' : 's'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="hint">
                  Nothing counted yet. Add your handle and press Check my stats now, or ask Claude
                  about your stats in a project.
                </p>
              )}
            </section>

            <section>
              <h2>Posted</h2>
              {status.drafts.some((d) => d.status === 'posted') ? (
                <ul className="list posts">
                  {status.drafts
                    .filter((d) => d.status === 'posted')
                    .slice(0, 30)
                    .map((d) => (
                      <li key={d.id}>
                        <span className="hint when">{when(d.posted ?? d.created)}</span>
                        <span className="tag">{PLATFORMS[d.platform].label}</span>
                        <span className="grow caption" title={d.caption}>
                          <strong>{d.video.split('/').pop()}</strong> {d.caption.split('\n')[0]}
                        </span>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="hint">
                  Nothing posted from Cutroom yet. Pick an exported video in the chat and ask Claude
                  for a caption.
                </p>
              )}
            </section>
          </div>
          <SocialChat status={status} rules={settings.social} onStatus={setStatus} />
        </div>
      )}

      {view === 'activity' && (
        <section>
          <h2>What was opened</h2>
          <p className="hint">
            Every page Claude and the automatic check opened, clicked or scrolled, newest first, and
            what the rules refused.
          </p>
          {status.visits.length ? (
            <ul className="list visits wide">
              {status.visits.map((v, i) => (
                <li key={`${v.at}-${i}`}>
                  <span className="hint when">{when(v.at)}</span>
                  <span className="tag">
                    {v.by === 'claude' ? 'Claude' : v.by === 'auto' ? 'Automatic' : 'You'}
                  </span>
                  {v.result !== 'opened' && (
                    <span className={v.result === 'refused' ? 'tag warn' : 'tag error'}>
                      {v.result === 'refused' ? 'Refused' : 'Failed'}
                    </span>
                  )}
                  <span className="path grow" title={v.url}>
                    {v.url}
                  </span>
                  {v.note && (
                    <span className="hint note-text" title={v.note}>
                      {v.note}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">Nothing yet.</p>
          )}
        </section>
      )}
    </div>
  );
}
