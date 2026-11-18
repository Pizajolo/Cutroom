import { TrendingDown, TrendingUp } from 'lucide-react';
import { PLATFORMS, SOCIAL_PLATFORMS, cleanHandle } from '../shared/social';
import type {
  SocialPlatform,
  SocialSettings,
  SocialSnapshot,
  SocialStatus,
  VideoStat,
} from '../shared/social';

/** The change of a profile count since the earliest count in the last `days` days. */
export function growth(
  rows: SocialSnapshot[],
  days: number,
  field: 'followers' | 'likes' = 'followers',
): number | undefined {
  const latest = rows.findLast((r) => r[field] !== undefined);
  if (!latest) return undefined;
  const since = Date.parse(latest.at) - days * 86_400_000;
  const base = rows.find(
    (r) => Date.parse(r.at) >= since && r[field] !== undefined && r !== latest,
  );
  return base ? latest[field]! - base[field]! : undefined;
}

/** 1,284 in full; 12.9K and 1.2M from ten thousand on. */
export const compact = (n: number): string =>
  Math.abs(n) < 10_000
    ? n.toLocaleString()
    : n.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 });
export const signed = (n?: number): string =>
  n === undefined ? '—' : `${n > 0 ? '+' : ''}${n.toLocaleString()}`;

/** `platform:handle` of the user's own accounts. */
export const ownAccounts = (rules: SocialSettings): string[] =>
  SOCIAL_PLATFORMS.filter((p) => cleanHandle(rules.handles[p])).map(
    (p) => `${p}:${cleanHandle(rules.handles[p])}`,
  );

export interface Figure {
  value?: number;
  /** Change in the last 7 days. */
  delta?: number;
  /** What it is made of, e.g. “TikTok 8,210 · Instagram 4,270”. */
  detail?: string;
}

export interface SocialSummary {
  /** Signed in to at least one platform. */
  connected: boolean;
  /** Anything counted for the own accounts. */
  counted: boolean;
  followers: Figure;
  views: Figure;
  likes: Figure;
  /** The own video with the most new views in the last 7 days. */
  best?: VideoStat;
  /** Own videos, most new views in the last 7 days first. */
  top: VideoStat[];
  /** Median views of the own videos, to say how a video compares. */
  typical?: number;
}

/** The headline numbers of the user's own accounts. */
export function summarize(status: SocialStatus, own: string[]): SocialSummary {
  const mine = (platform: SocialPlatform, handle: string): boolean =>
    own.includes(`${platform}:${handle}`);
  const byAccount = new Map<string, SocialSnapshot[]>();
  for (const s of status.snapshots.filter((s) => mine(s.platform, s.handle))) {
    const key = `${s.platform}:${s.handle}`;
    byAccount.set(key, [...(byAccount.get(key) ?? []), s]);
  }
  const videos = status.videos.filter((v) => mine(v.platform, v.handle));
  const sum = (values: (number | undefined)[]): number | undefined =>
    values.some((v) => v !== undefined)
      ? values.reduce<number>((n, v) => n + (v ?? 0), 0)
      : undefined;
  const latest = (field: 'followers' | 'likes') => (rows: SocialSnapshot[]) =>
    rows.findLast((r) => r[field] !== undefined)?.[field];
  const per = (fn: (rows: SocialSnapshot[]) => number | undefined): string =>
    [...byAccount.entries()]
      .flatMap(([key, rows]) => {
        const value = fn(rows);
        return value === undefined
          ? []
          : [`${PLATFORMS[key.split(':')[0] as SocialPlatform].label} ${compact(value)}`];
      })
      .join(' · ');
  const rows = [...byAccount.values()];
  const top = videos.filter((v) => v.views7d).sort((a, b) => b.views7d! - a.views7d!);
  const views = videos
    .flatMap((v) => (v.views === undefined ? [] : [v.views]))
    .sort((a, b) => a - b);
  const mid = views.length >> 1;
  return {
    connected: SOCIAL_PLATFORMS.some((p) => status.platforms[p].signedIn),
    counted: byAccount.size > 0 || videos.length > 0,
    followers: {
      value: sum(rows.map(latest('followers'))),
      delta: sum(rows.map((r) => growth(r, 7))),
      detail: per(latest('followers')),
    },
    views: {
      value: sum(videos.map((v) => v.views)),
      delta: sum(videos.map((v) => v.views7d)),
      detail: `${videos.length} video${videos.length === 1 ? '' : 's'} counted`,
    },
    likes: {
      value: sum(rows.map(latest('likes'))),
      delta: sum(rows.map((r) => growth(r, 7, 'likes'))),
      detail: per(latest('likes')),
    },
    best: top[0],
    top,
    typical: views.length
      ? views.length % 2
        ? views[mid]
        : (views[mid - 1]! + views[mid]!) / 2
      : undefined,
  };
}

/** A video's name for people: the Cutroom export it came from, else its caption. */
export const videoName = (v: VideoStat): string => v.file?.split('/').pop() ?? v.caption ?? v.id;

/** One big number: label, value, the change in the last 7 days and what it is made of. */
export function Tile({ label, figure }: { label: string; figure: Figure }) {
  const { value, delta, detail } = figure;
  return (
    <div className="tile">
      <span className="label">{label}</span>
      <strong className="value" title={value?.toLocaleString()}>
        {value === undefined ? '—' : compact(value)}
      </strong>
      <span
        className={
          delta === undefined
            ? 'delta hint'
            : delta > 0
              ? 'delta up'
              : delta < 0
                ? 'delta down'
                : 'delta'
        }
      >
        {delta === undefined ? (
          'No change counted yet'
        ) : (
          <>
            {delta > 0 ? <TrendingUp size={14} /> : delta < 0 ? <TrendingDown size={14} /> : null}
            {signed(delta)} in 7 days
          </>
        )}
      </span>
      {detail && <span className="hint detail">{detail}</span>}
    </div>
  );
}

/** This week's best video, as a tile. */
export function BestVideo({ summary }: { summary: SocialSummary }) {
  const best = summary.best;
  return (
    <div className="tile">
      <span className="label">Best video this week</span>
      <strong className="value">{best ? compact(best.views7d!) : '—'}</strong>
      <span className={best ? 'delta' : 'delta hint'}>
        {best ? 'new views in 7 days' : 'Needs two counts a few days apart'}
      </span>
      {best && (
        <span className="hint detail" title={best.caption ?? best.url}>
          {PLATFORMS[best.platform].label} · {videoName(best)}
        </span>
      )}
      {best?.views !== undefined && summary.typical && best.views >= summary.typical * 1.2 ? (
        <span className="tag ok fit">
          {(best.views / summary.typical).toFixed(1)}× your typical video
        </span>
      ) : null}
    </div>
  );
}
