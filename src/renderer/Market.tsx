import { useEffect, useState } from 'react';
import { Download, ExternalLink, Flag, LogIn, LogOut, RefreshCw, Search, ShoppingCart, Star, Trash2, Upload, X } from 'lucide-react';
import type { MarketAccount, MarketCheckReport, MarketDetail, MarketInstalled, MarketOwnSkill, MarketPublishResult, MarketQuery, MarketReview, MarketSkill, Skill } from '../shared/types';
import { api } from './lib';

const KINDS = [['', 'All'], ['style', 'Styles'], ['move', 'Moves']] as const;
const REASONS = [
  ['malicious', 'Malicious — tries to harm my Mac, files or accounts'],
  ['prompt-injection', 'Takes over Claude or ignores my instructions'],
  ['copyright', 'Copies someone else’s work'],
  ['spam', 'Spam or misleading'],
  ['broken', 'Doesn’t work'],
  ['other', 'Something else'],
] as const;

const price = (skill: Pick<MarketSkill, 'price'>): string =>
  skill.price.cents === 0 ? 'Free' : new Intl.NumberFormat(undefined, { style: 'currency', currency: skill.price.currency.toUpperCase() }).format(skill.price.cents / 100);
/** Remote errors come through IPC wrapped in "Error invoking remote method …". */
const message = (error: unknown): string => String((error as Error).message ?? error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function Stars({ value, onPick }: { value: number; onPick?: (n: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <span className="stars" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = n <= Math.round(hover || value);
        const star = <Star size={onPick ? 18 : 12} className={on ? 'favorite' : 'off'} />;
        return onPick ? (
          <button key={n} type="button" className="ghost" aria-label={`${n} star${n > 1 ? 's' : ''}`} onMouseEnter={() => setHover(n)} onClick={() => onPick(n)}>{star}</button>
        ) : (
          <span key={n}>{star}</span>
        );
      })}
    </span>
  );
}

/** The result of the marketplace's checks on a version: static findings and the AI review. */
export function CheckReport({ report }: { report: MarketCheckReport }) {
  return (
    <div className="check-report">
      <p><span className={`tag ${report.verdict === 'pass' ? 'ok' : report.verdict === 'block' ? 'bad' : 'warn'}`}>{report.verdict}</span> {report.reason}</p>
      {report.static.filter((f) => f.severity !== 'info').map((f, i) => (
        <div key={i} className="finding">
          <strong>{f.title}</strong> <span className="hint">{f.file}:{f.line} · {f.severity}</span>
          <code>{f.excerpt}</code>
        </div>
      ))}
      {report.ai && report.ai.verdict !== 'pass' && (
        <div className="finding">
          <strong>AI review: {report.ai.verdict}</strong> <span className="hint">risk {report.ai.risk}</span>
          <p>{report.ai.summary}</p>
          {report.ai.findings.map((f, i) => <code key={i}>{f.explanation}{f.quote ? ` — “${f.quote}”` : ''}</code>)}
        </div>
      )}
    </div>
  );
}

/** Publish one of your own styles or moves. */
export function PublishDialog({ skills, initial, account, onClose }: { skills: Skill[]; initial?: string; account: MarketAccount; onClose: () => void }) {
  const own = skills.filter((s) => s.custom);
  const [id, setId] = useState(initial ?? own[0]?.id ?? '');
  const [dollars, setDollars] = useState('0');
  const [changelog, setChangelog] = useState('');
  const [state, setState] = useState<{ busy?: boolean; error?: string; result?: MarketPublishResult }>({});
  const canSell = !!account.user?.payouts.chargesEnabled;
  const publish = async (): Promise<void> => {
    setState({ busy: true });
    try {
      setState({ result: await api.marketPublish(id, { priceCents: account.payments ? Math.round(Number(dollars || 0) * 100) : 0, changelog }) });
    } catch (error) {
      setState({ error: message(error) });
    }
  };
  const result = state.result;
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section role="dialog" aria-label="Publish to the marketplace" className="market-dialog narrow">
        <header>
          <h2>Publish to the marketplace</h2>
          <span className="spacer" />
          <button className="ghost" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </header>
        {!account.signedIn ? (
          <p className="hint">Sign in to the marketplace first (Home › Marketplace).</p>
        ) : result ? (
          <div className="body">
            <p>
              <strong>
                {result.state === 'live' ? `${result.skill.name} version ${result.version} is live.` : result.state === 'pending' ? `${result.skill.name} version ${result.version} is waiting for a moderator.` : `${result.skill.name} version ${result.version} was rejected.`}
              </strong>
            </p>
            <CheckReport report={result.report} />
            <div className="row"><button onClick={() => void api.marketOpenWeb(`/marketplace/${result.skill.slug}`)}><ExternalLink size={14} /> View on the web</button><span className="spacer" /><button className="primary" onClick={onClose}>Done</button></div>
          </div>
        ) : (
          <div className="body">
            <p className="hint">Your style or move — SKILL.md, the example clip and templates — is checked for malicious instructions and code, then published under its name. Publishing the same name again releases a new version.</p>
            <label className="stacked">Style or move
              <select value={id} onChange={(e) => setId(e.target.value)}>
                {own.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.kind})</option>)}
              </select>
            </label>
            {own.length === 0 && <p className="hint">You have no styles or moves of your own yet. Press “Save style” in a project’s chat.</p>}
            {own.find((s) => s.id === id)?.source && <p className="hint">Learned from someone else’s video, so its example clip stays on this Mac and isn’t uploaded.</p>}
            <div className="row">
              {account.payments && (
                <label className="stacked" style={{ width: 160 }}>Price (USD)
                  <input type="number" min="0" step="0.5" value={dollars} disabled={!canSell} onChange={(e) => setDollars(e.target.value)} />
                </label>
              )}
              <label className="stacked grow">What changed (optional)
                <input value={changelog} maxLength={2000} placeholder="First release" onChange={(e) => setChangelog(e.target.value)} />
              </label>
            </div>
            {account.payments && !canSell && <p className="hint">Free skills need nothing else. To sell, <button className="link" onClick={() => void api.marketOpenWeb('/account/payouts')}>set up payouts</button> on the web.</p>}
            {state.error && <p className="note error" style={{ whiteSpace: 'pre-wrap' }}>{state.error}</p>}
            <div className="row"><span className="spacer" /><button onClick={onClose}>Cancel</button><button className="primary" disabled={!id || state.busy} onClick={() => void publish()}>{state.busy ? 'Checking and publishing…' : 'Publish'}</button></div>
          </div>
        )}
      </section>
    </div>
  );
}

/** One marketplace skill: example, instructions, reviews, and what you can do with it. Also opened by cutroom:// links. */
export function SkillDialog({ slug, onLibrary, onClose }: { slug: string; onLibrary?: (skills: Skill[]) => void; onClose: () => void }) {
  const [skill, setSkill] = useState<MarketDetail | null>(null);
  const [installed, setInstalled] = useState<MarketInstalled | undefined>();
  const [tab, setTab] = useState<'About' | 'Instructions' | 'Reviews'>('About');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [reporting, setReporting] = useState<{ reason: string; details: string } | null>(null);
  const [notice, setNotice] = useState('');

  const load = (): Promise<void> =>
    Promise.all([api.marketDetail(slug), api.marketInstalled().catch(() => [])]).then(([d, local]) => {
      setInstalled(local.find((i) => i.slug === slug));
      setSkill(d);
      const mine = d.reviews.find((r) => r.mine);
      setRating(mine?.rating ?? 0);
      setBody(mine?.body ?? '');
    }, (e) => setError(message(e)));
  useEffect(() => void load(), [slug]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => void (e.key === 'Escape' && onClose());
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const act = async (name: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(name);
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy('');
    }
  };
  const setReviews = (reviews: MarketReview[]): void => setSkill((s) => s && { ...s, reviews });

  if (!skill) {
    return (
      <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <section role="dialog" className="market-dialog"><p className="hint">{error || 'Loading…'}</p></section>
      </div>
    );
  }
  const { viewer } = skill;
  const here = !!installed;
  const outdated = !!installed && !!skill.version && installed.version < skill.version;
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section role="dialog" aria-label={skill.name} className="market-dialog">
        <header>
          <h2>{skill.name}</h2>
          <span className="tag">{skill.kind === 'move' ? 'Move' : 'Style'}</span>
          <span className="tag">{price(skill)}</span>
          {skill.tags.map((t) => <span key={t} className="tag">{t}</span>)}
          <span className="spacer" />
          {viewer.signedIn && (
            <button className={viewer.favorite ? 'ghost favorite' : 'ghost'} aria-pressed={viewer.favorite} title={viewer.favorite ? 'Remove from favourites' : 'Add to favourites'} onClick={() => void act('fav', () => api.marketSetFavorite(slug, !viewer.favorite))}>
              <Star size={16} />
            </button>
          )}
          <button className="ghost" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </header>
        <p className="description">
          {skill.description} <span className="hint">by {skill.author.name}{skill.version ? ` · version ${skill.version}` : ''} · {skill.stats.downloads} downloads</span>
          {skill.stats.ratings > 0 && <> · <Stars value={skill.stats.rating} /> <span className="hint">{skill.stats.rating.toFixed(1)} ({skill.stats.ratings})</span></>}
        </p>
        <div className="row">
          {!viewer.signedIn ? (
            <span className="hint">Sign in to install.</span>
          ) : viewer.canDownload ? (
            <button className="primary" disabled={!!busy || (here && !outdated)} onClick={() => void act('install', async () => onLibrary?.(await api.marketInstall(slug)))}>
              {outdated ? <RefreshCw size={14} /> : <Download size={14} />} {busy === 'install' ? 'Installing…' : outdated ? `Update to version ${skill.version}` : here ? 'Installed' : 'Install'}
            </button>
          ) : skill.price.cents > 0 && !viewer.purchased ? (
            <button className="primary" disabled={!!busy} onClick={() => void act('buy', async () => (await api.marketBuy(slug), setNotice('Finish the payment in your browser, then press Install.')))}><ShoppingCart size={14} /> Buy for {price(skill)}</button>
          ) : (
            <span className="note">Not available right now.</span>
          )}
          {here && <button disabled={!!busy} onClick={() => void act('remove', async () => onLibrary?.(await api.marketUninstall(slug)))}><Trash2 size={14} /> Uninstall</button>}
          <span className="spacer" />
          {viewer.signedIn && !viewer.owned && <button className="ghost" onClick={() => setReporting({ reason: 'malicious', details: '' })}><Flag size={14} /> Report</button>}
          <button className="ghost" onClick={() => void api.marketOpenWeb(`/marketplace/${slug}`)}><ExternalLink size={14} /> Web page</button>
        </div>
        {(error || notice) && <p className={error ? 'note error' : 'note'} style={{ whiteSpace: 'pre-wrap' }}>{error || notice}</p>}
        {installed?.removed && <p className="note error">{installed.removed} Uninstall it.</p>}
        <div className="switch" role="tablist">
          {(['About', 'Instructions', 'Reviews'] as const).map((name) => (
            <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>{name}{name === 'Reviews' && skill.reviews.length ? ` (${skill.reviews.length})` : ''}</button>
          ))}
        </div>
        <div className="body">
          {tab === 'About' && (
            <>
              {skill.exampleUrl ? <video className="market-example" src={`media://marketplace/${skill.slug}`} controls preload="metadata" /> : <p className="hint">No example clip.</p>}
              {skill.source && <p className="hint">Learned from {skill.source}</p>}
              <p className="hint">Files: {skill.files.map((f) => f.path).join(' · ')}</p>
              {skill.versions[0]?.changelog && <p className="hint">Version {skill.versions[0].version}: {skill.versions[0].changelog}</p>}
            </>
          )}
          {tab === 'Instructions' && <textarea readOnly value={skill.instructions} aria-label="Instructions" spellCheck={false} />}
          {tab === 'Reviews' && (
            <>
              {viewer.installed && !viewer.owned ? (
                <div className="review-form">
                  <Stars value={rating} onPick={setRating} />
                  <textarea placeholder="What worked, what didn’t, what footage you used it on…" value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} />
                  <div className="row">
                    <button className="primary" disabled={!rating || !!busy} onClick={() => void act('review', async () => setReviews(await api.marketReview(slug, rating, body)))}>{viewer.reviewed ? 'Update review' : 'Post review'}</button>
                    {viewer.reviewed && <button className="ghost" onClick={() => void act('review', async () => setReviews(await api.marketDeleteReview(slug)))}>Delete my review</button>}
                  </div>
                </div>
              ) : (
                <p className="hint">{viewer.owned ? 'You can’t review your own skill.' : 'Install the skill to review it.'}</p>
              )}
              {skill.reviews.length === 0 && <p className="hint">No reviews yet.</p>}
              <ul className="list">
                {skill.reviews.map((r) => (
                  <li key={r.id} className="review">
                    <div className="row"><strong>{r.author.name}</strong><Stars value={r.rating} /><span className="hint">{new Date(r.updatedAt).toLocaleDateString()}</span></div>
                    {r.body && <p>{r.body}</p>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        {reporting && (
          <div className="report">
            <strong>Report “{skill.name}”</strong>
            {REASONS.map(([value, label]) => (
              <label key={value} className="choice"><input type="radio" checked={reporting.reason === value} onChange={() => setReporting({ ...reporting, reason: value })} /> {label}</label>
            ))}
            <textarea placeholder="What happened? (optional)" value={reporting.details} onChange={(e) => setReporting({ ...reporting, details: e.target.value })} />
            <div className="row">
              <span className="spacer" />
              <button onClick={() => setReporting(null)}>Cancel</button>
              <button className="primary" onClick={() => void act('report', async () => (await api.marketReport(slug, reporting.reason, reporting.details), setReporting(null), setNotice('Thanks — the moderators will look at it.')))}>Send report</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Card({ skill, installed, onOpen }: { skill: MarketSkill; installed?: MarketInstalled; onOpen: () => void }) {
  return (
    <button className="market-card" onClick={onOpen}>
      <span className="market-thumb">{skill.exampleUrl ? <video src={`media://marketplace/${skill.slug}#t=0.5`} muted preload="metadata" /> : <span className="hint">{skill.kind === 'move' ? 'Move' : 'Style'}</span>}</span>
      <span className="row"><strong>{skill.name}</strong><span className="spacer" /><span className="tag">{price(skill)}</span></span>
      <span className="description">{skill.description}</span>
      <span className="row hint">
        {skill.author.name}
        <span className="spacer" />
        {skill.stats.ratings > 0 && <><Star size={11} className="favorite" /> {skill.stats.rating.toFixed(1)}</>}
        <Download size={11} /> {skill.stats.downloads}
        {installed && <span className={installed.updateAvailable ? 'tag warn' : 'tag ok'}>{installed.updateAvailable ? 'Update' : 'Installed'}</span>}
      </span>
    </button>
  );
}

type Tab = 'Browse' | 'Installed' | 'Favourites' | 'Published';

/** Home › Marketplace: find, install and publish skills. */
export function Market() {
  const [account, setAccount] = useState<MarketAccount | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [tab, setTab] = useState<Tab>('Browse');
  const [query, setQuery] = useState<MarketQuery>({ sort: 'popular' });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<{ skills: MarketSkill[]; total: number } | null>(null);
  const [installed, setInstalled] = useState<MarketInstalled[]>([]);
  const [favorites, setFavorites] = useState<MarketSkill[]>([]);
  const [mine, setMine] = useState<MarketOwnSkill[]>([]);
  const [library, setLibrary] = useState<Skill[]>([]);
  const [shown, setShown] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');

  const refreshInstalled = (): void => void api.marketInstalled().then(setInstalled, () => {});
  useEffect(() => {
    void api.marketAccount().then(setAccount);
    void api.listSkills().then(setLibrary);
    refreshInstalled();
  }, []);
  useEffect(() => {
    if (tab !== 'Browse') return;
    setError('');
    const timer = setTimeout(() => void api.marketBrowse({ ...query, q: search || undefined }).then(setPage, (e) => setError(message(e))), 250);
    return () => clearTimeout(timer);
  }, [tab, query, search]);
  useEffect(() => {
    if (!account?.signedIn) return;
    if (tab === 'Favourites') void api.marketFavorites().then(setFavorites, (e) => setError(message(e)));
    if (tab === 'Published') void api.marketMine().then(setMine, (e) => setError(message(e)));
  }, [tab, account?.signedIn, publishing]);

  const signIn = async (): Promise<void> => {
    setSigningIn(true);
    setError('');
    try {
      setAccount(await api.marketLogin());
      refreshInstalled();
    } catch (e) {
      setError(message(e));
    } finally {
      setSigningIn(false);
    }
  };
  const byslug = (slug: string): MarketInstalled | undefined => installed.find((i) => i.slug === slug);
  const updates = installed.filter((i) => i.updateAvailable).length;

  return (
    <>
      <div className="row">
        <h1>Marketplace</h1>
        <span className="spacer" />
        {account?.signedIn ? (
          <>
            <span className="avatar" aria-hidden>{(account.user?.name ?? '?').slice(0, 1).toUpperCase()}</span>
            <span className="hint">{account.user?.name ?? 'Signed in'}</span>
            <button className="ghost" title="Sign out of the marketplace" onClick={() => void api.marketLogout().then(setAccount)}><LogOut size={14} /></button>
          </>
        ) : (
          <button className="primary" disabled={signingIn || !account} onClick={() => void signIn()}><LogIn size={16} /> {signingIn ? 'Waiting for the browser…' : 'Sign in with Google'}</button>
        )}
      </div>
      <p className="hint">
        Styles and moves made by other editors. Installed ones appear in your Library, ready to pick in any project. Every skill is checked for malicious
        instructions before it is published — report anything that slipped through.
      </p>
      <div className="row">
        <div className="switch" role="tablist">
          {(['Browse', 'Installed', 'Favourites', 'Published'] as const).map((name) => (
            <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>{name}{name === 'Installed' && updates ? ` (${updates} update${updates > 1 ? 's' : ''})` : ''}</button>
          ))}
        </div>
        <span className="spacer" />
        {tab === 'Published' && account?.signedIn && <button className="primary" onClick={() => setPublishing(true)}><Upload size={14} /> Publish a style or move</button>}
      </div>
      {error && <p className="note error">{error}</p>}

      {tab === 'Browse' && (
        <>
          <div className="row">
            <div className="switch" role="tablist" aria-label="Kind">
              {KINDS.map(([value, label]) => <button key={value} role="tab" aria-selected={(query.kind ?? '') === value} onClick={() => setQuery({ ...query, kind: (value || undefined) as MarketQuery['kind'] })}>{label}</button>)}
            </div>
            <div className="grow search"><Search size={14} /><input type="search" placeholder="Search captions, transitions, podcast…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            {account?.payments && (
              <select value={query.price ?? ''} onChange={(e) => setQuery({ ...query, price: (e.target.value || undefined) as MarketQuery['price'] })}>
                <option value="">Any price</option><option value="free">Free</option><option value="paid">Paid</option>
              </select>
            )}
            <select value={query.sort} onChange={(e) => setQuery({ ...query, sort: e.target.value as MarketQuery['sort'] })}>
              <option value="popular">Most downloaded</option><option value="rating">Top rated</option><option value="favorites">Most favourited</option><option value="new">Newest</option>
            </select>
          </div>
          {page === null && !error && <p className="hint">Loading…</p>}
          {page && page.skills.length === 0 && <p className="hint">Nothing matches.</p>}
          <div className="market-grid">{page?.skills.map((s) => <Card key={s.slug} skill={s} installed={byslug(s.slug)} onOpen={() => setShown(s.slug)} />)}</div>
        </>
      )}

      {tab === 'Installed' && (
        <ul className="list">
          {installed.length === 0 && <li className="hint">Nothing installed from the marketplace yet.</li>}
          {installed.map((i) => (
            <li key={i.slug}>
              <button className="ghost grow tall" onClick={() => setShown(i.slug)}>
                <strong>{i.skill?.name ?? i.slug}</strong> <span className="tag">version {i.version || '?'}</span>
                {i.updateAvailable && <span className="tag warn">version {i.latestVersion} available</span>}
                {i.removed && <span className="tag bad">removed by moderators</span>}
                {i.skill && <span className="description">{i.skill.description}</span>}
              </button>
              {i.updateAvailable && <button onClick={() => void api.marketInstall(i.slug).then(setLibrary).then(refreshInstalled, (e) => setError(message(e)))}><RefreshCw size={14} /> Update</button>}
              <button className="ghost" title="Uninstall" onClick={() => confirm(`Uninstall “${i.skill?.name ?? i.slug}”?`) && void api.marketUninstall(i.slug).then(setLibrary).then(refreshInstalled)}><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      )}

      {tab === 'Favourites' && (account?.signedIn ? (
        <div className="market-grid">
          {favorites.length === 0 && <p className="hint">Star skills to keep them here.</p>}
          {favorites.map((s) => <Card key={s.slug} skill={s} installed={byslug(s.slug)} onOpen={() => setShown(s.slug)} />)}
        </div>
      ) : <p className="hint">Sign in to see your favourites.</p>)}

      {tab === 'Published' && (account?.signedIn ? (
        <>
          <ul className="list">
            {mine.length === 0 && <li className="hint">You haven’t published anything yet.</li>}
            {mine.map(({ skill, latest, sales }) => (
              <li key={skill.slug}>
                <button className="ghost grow tall" onClick={() => setShown(skill.slug)}>
                  <strong>{skill.name}</strong> <span className={`tag ${skill.status === 'published' ? 'ok' : skill.status === 'pending' ? 'warn' : skill.status === 'unlisted' ? '' : 'bad'}`}>{skill.status}</span>
                  {latest && latest.reviewStatus !== 'approved' && <span className={`tag ${latest.reviewStatus === 'pending' ? 'warn' : 'bad'}`}>version {latest.version} {latest.reviewStatus === 'pending' ? 'in review' : 'rejected'}</span>}
                  <span className="tag">{price(skill)}</span>
                  <span className="description">{skill.stats.downloads} downloads · {skill.stats.ratings ? `${skill.stats.rating.toFixed(1)}★ (${skill.stats.ratings})` : 'no reviews'}{sales ? ` · ${sales} sold` : ''}</span>
                  {latest?.reason && latest.reviewStatus !== 'approved' && <span className="description faint">{latest.reason}</span>}
                </button>
                {skill.status === 'published' && <button className="ghost" onClick={() => void api.marketUpdateOwn(skill.slug, { listed: false }).then(() => api.marketMine()).then(setMine)}>Unlist</button>}
                {skill.status === 'unlisted' && <button className="ghost" onClick={() => void api.marketUpdateOwn(skill.slug, { listed: true }).then(() => api.marketMine()).then(setMine)}>List</button>}
              </li>
            ))}
          </ul>
          <p className="hint">Check reports, prices, sales and payouts: <button className="link" onClick={() => void api.marketOpenWeb('/account')}>My skills on the web</button>.</p>
        </>
      ) : <p className="hint">Sign in to publish your styles and moves.</p>)}

      {shown && <SkillDialog key={shown} slug={shown} onLibrary={(skills) => (setLibrary(skills), refreshInstalled())} onClose={() => (setShown(''), refreshInstalled())} />}
      {publishing && account && <PublishDialog skills={library} account={account} onClose={() => setPublishing(false)} />}
    </>
  );
}
