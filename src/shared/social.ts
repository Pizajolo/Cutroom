// Social analytics through the user's own TikTok and Instagram web sign-in.
// Shared by the main process (which enforces these rules) and the UI (which lets the user set them).

export const PLATFORMS = {
  tiktok: {
    label: 'TikTok',
    home: 'https://www.tiktok.com/',
    login: 'https://www.tiktok.com/login/phone-or-email/email',
    /** Where the own analytics live. */
    analytics: 'https://www.tiktok.com/tiktokstudio/analytics',
    profile: (handle: string) => `https://www.tiktok.com/@${handle}`,
    /** Sites the window may show for this platform (and their subdomains). */
    hosts: ['tiktok.com'],
    /** The cookie that exists while signed in. */
    session: { domain: 'tiktok.com', cookie: 'sessionid' },
  },
  instagram: {
    label: 'Instagram',
    home: 'https://www.instagram.com/',
    login: 'https://www.instagram.com/accounts/login/',
    analytics: 'https://business.facebook.com/latest/insights/',
    profile: (handle: string) => `https://www.instagram.com/${handle}/`,
    // Full Instagram insights are on the web only in Meta Business Suite, which signs in through Facebook.
    hosts: ['instagram.com', 'business.facebook.com', 'facebook.com'],
    session: { domain: 'instagram.com', cookie: 'sessionid' },
  },
} as const;
export type SocialPlatform = keyof typeof PLATFORMS;
export const SOCIAL_PLATFORMS = Object.keys(PLATFORMS) as SocialPlatform[];

/** What kind of page a link is. Only `own`, `profile`, `post` and `search` can be switched on for Claude. */
export type PageKind = 'own' | 'profile' | 'post' | 'search' | 'login' | 'blocked';

export const PAGE_KINDS: Record<'own' | 'profile' | 'post' | 'search', { label: string; hint: string }> = {
  own: { label: 'My profile and analytics', hint: 'TikTok Studio, Meta Business Suite insights, your own profile' },
  profile: { label: 'Other profiles', hint: 'Competitors’ profile pages: followers, likes, their latest posts' },
  post: { label: 'Single posts and videos', hint: 'One video or post with its views, likes and comments' },
  search: { label: 'Search and hashtags', hint: 'Finding accounts and trending posts by keyword or hashtag' },
};

/** How long Claude waits between two pages, in seconds (a random time in this range). */
export const PACES = {
  careful: { label: 'Careful', seconds: [12, 25] },
  normal: { label: 'Normal', seconds: [6, 12] },
  quick: { label: 'Quick', seconds: [3, 6] },
} as const;
export type Pace = keyof typeof PACES;

export const AUTO_CHECKS = {
  off: { label: 'Only when I ask', hours: 0 },
  daily: { label: 'Once a day', hours: 24 },
  weekly: { label: 'Once a week', hours: 24 * 7 },
} as const;
export type AutoCheck = keyof typeof AUTO_CHECKS;

export interface SocialSettings {
  /** When the user accepted the warning (ISO time). Nothing reaches the sites before that. */
  accepted?: string;
  /** Your own handle per platform, without @. Tells your pages apart from competitors’. */
  handles: Record<SocialPlatform, string>;
  /** Platforms Claude may open at all. */
  platforms: Record<SocialPlatform, boolean>;
  /** Kinds of pages Claude may open. */
  pages: Record<keyof typeof PAGE_KINDS, boolean>;
  /** If not empty, the only other accounts Claude may open (handles, without @). */
  competitors: string[];
  pace: Pace;
  /** Most pages Claude may open in reply to one message. */
  perMessage: number;
  /** Most pages per day, for Claude and the automatic checks together. */
  perDay: number;
  /** Open the follower counts of your own profiles automatically, while Cutroom is open. */
  autoCheck: AutoCheck;
  /** Show the browser window while Claude works in it (otherwise it only appears for sign-in). */
  showWindow: boolean;
}

export const DEFAULT_SOCIAL: SocialSettings = {
  handles: { tiktok: '', instagram: '' },
  platforms: { tiktok: true, instagram: true },
  pages: { own: true, profile: true, post: true, search: false },
  competitors: [],
  pace: 'careful',
  perMessage: 15,
  perDay: 60,
  autoCheck: 'off',
  showWindow: true,
};

/** Read saved settings that may come from an older version. */
export const socialSettings = (saved?: Partial<SocialSettings>): SocialSettings => ({
  ...DEFAULT_SOCIAL,
  ...saved,
  handles: { ...DEFAULT_SOCIAL.handles, ...saved?.handles },
  platforms: { ...DEFAULT_SOCIAL.platforms, ...saved?.platforms },
  pages: { ...DEFAULT_SOCIAL.pages, ...saved?.pages },
});

export const cleanHandle = (handle: string): string => handle.trim().replace(/^@/, '').replace(/\/+$/, '').toLowerCase();

const onHost = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

/** Which platform a link belongs to, if any. */
export function platformOf(url: URL): SocialPlatform | undefined {
  return SOCIAL_PLATFORMS.find((p) => PLATFORMS[p].hosts.some((d) => onHost(url.hostname, d)));
}

// Paths on instagram.com that are not profiles.
const IG_RESERVED = new Set(['accounts', 'explore', 'direct', 'reels', 'stories', 'p', 'reel', 'tv', 'about', 'legal', 'developer', 'challenge', 'web', 'emails']);

/** What kind of page a link is, for the rules above. Messages, settings and anything unknown are blocked. */
export function classify(url: URL, handles: Record<SocialPlatform, string>): { platform?: SocialPlatform; kind: PageKind; handle?: string } {
  const platform = platformOf(url);
  if (!platform || url.protocol !== 'https:') return { kind: 'blocked' };
  const parts = url.pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p));
  const mine = cleanHandle(handles[platform]);
  const profile = (handle: string): { platform: SocialPlatform; kind: PageKind; handle: string } => {
    const h = cleanHandle(handle);
    return { platform, kind: mine && h === mine ? 'own' : 'profile', handle: h };
  };
  const host = url.hostname;

  if (platform === 'tiktok') {
    if (parts[0] === 'login' || parts[0] === 'signup') return { platform, kind: 'login' };
    if (parts[0] === 'tiktokstudio' && (parts.length === 1 || parts[1] === 'analytics' || parts[1] === 'content')) return { platform, kind: 'own' };
    if (parts[0]?.startsWith('@')) {
      if (parts[1] === 'video' || parts[1] === 'photo') return { platform, kind: 'post', handle: cleanHandle(parts[0]) };
      if (parts.length === 1) return profile(parts[0]);
    }
    if (parts[0] === 'search' || parts[0] === 'tag' || parts[0] === 'discover') return { platform, kind: 'search' };
    return { platform, kind: 'blocked' };
  }

  // Instagram, and Meta Business Suite for its insights.
  if (onHost(host, 'business.facebook.com')) {
    return parts[0] === 'latest' && (parts[1] === 'insights' || parts[1] === 'content') ? { platform, kind: 'own' } : { platform, kind: 'blocked' };
  }
  if (onHost(host, 'facebook.com')) return parts[0] === 'login' || parts[0] === 'login.php' ? { platform, kind: 'login' } : { platform, kind: 'blocked' };
  if (parts[0] === 'accounts' && (parts[1] === 'login' || parts[1] === 'onetap')) return { platform, kind: 'login' };
  if (parts[0] === 'challenge' || onHost(host, 'accountscenter.instagram.com')) return { platform, kind: 'login' };
  if (parts[0] === 'p' || parts[0] === 'reel' || parts[0] === 'tv') return { platform, kind: 'post' };
  if (parts[0] === 'explore' && (parts[1] === 'tags' || parts[1] === 'search')) return { platform, kind: 'search' };
  if (parts[0] && !IG_RESERVED.has(parts[0])) {
    // instagram.com/<handle>/ and its posts and reels tabs.
    if (parts[1] === 'p' || parts[1] === 'reel') return { platform, kind: 'post', handle: cleanHandle(parts[0]) };
    if (parts.length === 1 || (parts.length === 2 && (parts[1] === 'reels' || parts[1] === 'tagged'))) return profile(parts[0]);
  }
  return { platform, kind: 'blocked' };
}

/** Whether the rules let Claude open this link, and why not. */
export function allowed(url: URL, rules: SocialSettings): { ok: true; platform: SocialPlatform; kind: PageKind } | { ok: false; reason: string } {
  const page = classify(url, rules.handles);
  if (!page.platform) return { ok: false, reason: 'Only TikTok and Instagram pages can be opened.' };
  const label = PLATFORMS[page.platform].label;
  if (!rules.platforms[page.platform]) return { ok: false, reason: `The user switched ${label} off for Claude.` };
  if (page.kind === 'login') return { ok: false, reason: `That is the ${label} sign-in page. Ask the user to sign in under Home › Social.` };
  if (page.kind === 'blocked') {
    return { ok: false, reason: 'This kind of page is not allowed (messages, settings, feeds and anything that is not a profile, post, search or your own analytics).' };
  }
  if (!rules.pages[page.kind as keyof typeof PAGE_KINDS]) return { ok: false, reason: `The user does not allow “${PAGE_KINDS[page.kind as keyof typeof PAGE_KINDS].label}”.` };
  const listed = rules.competitors.map(cleanHandle).filter(Boolean);
  if ((page.kind === 'profile' || page.kind === 'post') && listed.length && page.handle && page.handle !== cleanHandle(rules.handles[page.platform]) && !listed.includes(page.handle)) {
    return { ok: false, reason: `@${page.handle} is not on the user’s competitor list (${listed.map((h) => `@${h}`).join(', ')}).` };
  }
  return { ok: true, platform: page.platform, kind: page.kind };
}

/** Counts read from a profile at one moment. Numbers as shown (“12.3K”) are kept next to the parsed value. */
export interface SocialSnapshot {
  at: string;
  platform: SocialPlatform;
  handle: string;
  /** `auto` = the scheduled check, `claude` = Claude recorded it, `manual` = Check now. */
  source: 'auto' | 'claude' | 'manual';
  followers?: number;
  following?: number;
  likes?: number;
  posts?: number;
  /** Anything else Claude read (views in the last 7 days, profile visits, …). */
  extra?: Record<string, number | string>;
}

/** One page opened in the social browser, for the activity list. */
export interface SocialVisit {
  at: string;
  url: string;
  /** Who opened it. */
  by: 'claude' | 'auto' | 'you';
  /** `refused` = the rules did not allow it. */
  result: 'opened' | 'refused' | 'failed';
  note?: string;
}

export interface SocialStatus {
  accepted: boolean;
  platforms: Record<SocialPlatform, {
    signedIn: boolean;
    /** The sign-in saved in the Keychain, shown as the user name only. */
    savedLogin?: string;
  }>;
  /** Pages opened today, out of `perDay`. */
  today: number;
  visits: SocialVisit[];
  snapshots: SocialSnapshot[];
  /** The automatic check is running, or why it last failed. */
  checking: boolean;
  lastCheck?: { at: string; error?: string };
}

/** Parse “12.3K”, “1,234”, “1.2M”, “3 Mio.”, “4,5 Tsd.” into a number. */
export function parseCount(text: string): number | undefined {
  const m = /([\d.,]+)\s*([KkMmBb]|Mio\.?|Tsd\.?|Mrd\.?)?/.exec(text.trim());
  if (!m) return undefined;
  let digits = m[1]!;
  const unit = (m[2] ?? '').toLowerCase();
  // “1.234” and “1,234” are thousands; “12.3K” and “4,5 Tsd.” are decimals before a unit.
  if (unit) digits = digits.replace(',', '.');
  else digits = digits.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.');
  const value = Number(digits);
  if (!Number.isFinite(value)) return undefined;
  const scale = unit.startsWith('k') || unit.startsWith('tsd') ? 1e3 : unit.startsWith('m') && !unit.startsWith('mrd') ? 1e6 : unit.startsWith('b') || unit.startsWith('mrd') ? 1e9 : 1;
  return Math.round(value * scale);
}
