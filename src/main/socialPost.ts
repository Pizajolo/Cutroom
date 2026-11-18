// Posting exported videos to TikTok and Instagram. Claude only proposes posts (the `propose_post` tool); publishing
// starts with the user's Post button and runs here, in the signed-in Social window, which is always shown while it
// works. Each step falls back to the user: if a page looks different from what is expected, the window stays open at
// that step, the caption goes to the clipboard, and the user finishes by hand.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { clipboard } from 'electron';
import type { BrowserWindow } from 'electron';
import { z } from 'zod';
import { CAPTION_LIMITS, PLATFORMS } from '../shared/social';
import type { ExportedVideo, SocialDraft, SocialPlatform } from '../shared/social';
import { recentProjects } from './project';
import { browser, changed, exclusive, load, logVisit, readDrafts, setPosting, settle, signedIn, sleep, writeDrafts } from './social';

const VIDEO = /\.(mp4|mov|m4v|webm)$/i;

/** Videos in the exports/ folders of the recent projects, newest first. Only these can be posted. */
export async function exportedVideos(): Promise<ExportedVideo[]> {
  const found: ExportedVideo[] = [];
  for (const project of await recentProjects()) {
    const dir = path.join(project.root, 'exports');
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (!VIDEO.test(name) || name.startsWith('.')) continue;
      const info = await stat(path.join(dir, name)).catch(() => null);
      if (info?.isFile()) found.push({ path: path.join(dir, name), name, project: project.name, at: info.mtime.toISOString(), size: info.size });
    }
  }
  return found.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 300);
}

// --- Drafts --------------------------------------------------------------------------------------------

async function update(id: string, patch: Partial<SocialDraft>): Promise<SocialDraft> {
  const drafts = await readDrafts();
  const draft = drafts.find((d) => d.id === id);
  if (!draft) throw new Error('That draft no longer exists.');
  Object.assign(draft, patch);
  await writeDrafts(drafts);
  return draft;
}

/** At start: a post that was under way when Cutroom quit is unknown. Free it, and say to check before trying again. */
export async function recover(): Promise<void> {
  const drafts = await readDrafts();
  const stuck = drafts.filter((d) => d.status === 'posting' || d.status === 'waiting');
  if (!stuck.length) return;
  for (const d of stuck) Object.assign(d, { status: 'failed', progress: 'Cutroom was closed while posting this. Check your profile before you try again: it may have been posted.' });
  await writeDrafts(drafts);
}

export const discard = async (id: string): Promise<void> => {
  const draft = (await readDrafts()).find((d) => d.id === id);
  if (draft && (draft.status === 'posting' || draft.status === 'waiting')) throw new Error('This video is being posted.');
  await update(id, { status: 'discarded' });
};

/** A short list of the drafts for Claude, so it knows what the user did with its proposals. */
export async function draftSummary(): Promise<string> {
  const recent = (await readDrafts()).slice(-12);
  if (!recent.length) return '';
  return `\n\n<drafts note="Your earlier proposals and what happened to them. Only the user posts.">\n${recent
    .map((d) => `- ${d.id}: ${PLATFORMS[d.platform].label}, ${path.basename(d.video)} — ${d.status}${d.posted ? ` ${d.posted}` : ''}${d.progress && d.status !== 'posted' ? ` (${d.progress})` : ''}`)
    .join('\n')}\n</drafts>`;
}

/** Claude's one way towards a post: it shows the user a draft. There is deliberately no tool that publishes. */
export const proposeTool = tool(
  'propose_post',
  'Show the user a draft post: one exported video, one platform, your caption. The user can edit it and press Post, or discard it. You cannot post yourself.',
  {
    platform: z.enum(['tiktok', 'instagram']),
    video: z.string().describe('Absolute path of an exported video (from the <videos> list).'),
    caption: z.string().min(1).describe('The full caption with hashtags, exactly as it should appear.'),
    note: z.string().optional().describe('For the user only, not posted: rights to check, the best time to post, anything to look at.'),
    ai_generated: z.boolean().optional().describe('True if the video has AI-generated picture or sound (see the project ledger). The user then sets the platform’s AI label.'),
    replaces: z.string().optional().describe('The id of an earlier draft this one replaces (e.g. a shorter caption).'),
  },
  async (args) => {
    const fail = (message: string): { content: { type: 'text'; text: string }[]; isError: true } => ({ content: [{ type: 'text', text: message }], isError: true });
    if (!(await exportedVideos()).some((v) => v.path === args.video)) return fail(`${args.video} is not an exported video of a recent project. Use a path from the <videos> list.`);
    const limit = CAPTION_LIMITS[args.platform];
    if (args.caption.length > limit) return fail(`The caption has ${args.caption.length} characters; ${PLATFORMS[args.platform].label} allows ${limit}. Shorten it.`);
    if (args.platform === 'instagram' && (args.caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > 30) return fail('Instagram allows at most 30 hashtags.');
    const drafts = await readDrafts();
    if (args.replaces) {
      const old = drafts.find((d) => d.id === args.replaces);
      if (old?.status === 'draft' || old?.status === 'failed') old.status = 'discarded';
    }
    const draft: SocialDraft = {
      id: `d-${randomUUID().slice(0, 8)}`,
      created: new Date().toISOString(),
      platform: args.platform,
      video: args.video,
      caption: args.caption,
      note: args.note,
      aiGenerated: args.ai_generated,
      status: 'draft',
    };
    await writeDrafts([...drafts, draft]);
    return { content: [{ type: 'text', text: `Draft ${draft.id} is shown to the user, who can edit the caption and post it or discard it. Don’t repeat the caption in full in your reply.` }] };
  },
);

// --- Driving the upload pages ------------------------------------------------------------------------------

/** Wait until `expression` (run in the page) is truthy, and return its value. */
async function waitFor<T>(w: BrowserWindow, expression: string, seconds: number): Promise<T | undefined> {
  for (let i = 0; i < seconds * 2; i++) {
    const value = (await w.webContents.executeJavaScript(expression).catch(() => undefined)) as T | undefined;
    if (value) return value;
    await sleep(500);
  }
  return undefined;
}

/** Find a visible button, link or tab by its exact text (or aria-label). Returns an expression for the element. */
const byText = (texts: string[], scope = 'document'): string => `(() => {
  const want = ${JSON.stringify(texts.map((t) => t.toLowerCase()))};
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const label = (el) => ((el.innerText || '').trim() || (el.getAttribute('aria-label') || '').trim()).toLowerCase();
  const all = [...(${scope}).querySelectorAll('button, [role="button"], a, [role="menuitem"], [role="link"], svg[aria-label]')];
  const el = all.find((c) => visible(c) && want.includes(label(c)));
  return el ? (el.closest('button, [role="button"], a, [role="link"], [role="menuitem"]') || el) : null;
})()`;

/** Click it, if it is there and enabled. */
const clickText = async (w: BrowserWindow, texts: string[], seconds: number, scope?: string): Promise<boolean> =>
  !!(await waitFor<boolean>(w, `(() => { const el = ${byText(texts, scope)}; if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return false; el.click(); return true; })()`, seconds));

/** Hand the video to a file input through the DevTools protocol: the same as choosing it in the file dialog. */
async function chooseFile(w: BrowserWindow, selector: string, file: string): Promise<boolean> {
  const dbg = w.webContents.debugger;
  const own = !dbg.isAttached();
  if (own) dbg.attach('1.3');
  try {
    const { result } = (await dbg.sendCommand('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})` })) as { result: { objectId?: string; subtype?: string } };
    if (!result.objectId || result.subtype === 'null') return false;
    await dbg.sendCommand('DOM.enable');
    await dbg.sendCommand('DOM.setFileInputFiles', { files: [file], objectId: result.objectId });
    return true;
  } finally {
    if (own) dbg.detach();
  }
}

/** Type the caption into the page's caption box, replacing what is there. Line by line, so line breaks survive. */
async function typeCaption(w: BrowserWindow, selector: string, caption: string): Promise<boolean> {
  const found = await w.webContents.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.focus();
    document.execCommand('selectAll');
    document.execCommand('delete');
    return true;
  })()`);
  if (!found) return false;
  const lines = caption.split('\n');
  for (const [i, line] of lines.entries()) {
    if (line) w.webContents.insertText(line);
    await sleep(250);
    if (i < lines.length - 1) {
      // Close a hashtag or mention suggestion first, so Enter makes a new line instead of picking it.
      w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      w.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
      w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      await sleep(150);
    }
  }
  w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  return true;
}

/** Thrown when a page does not look as expected: the user takes over from there. */
class Stuck extends Error {}

interface Flow {
  /** Everything up to the final click. */
  prepare: (w: BrowserWindow, draft: SocialDraft, say: (text: string) => Promise<void>) => Promise<void>;
  /** The final click. False if the button is not there. */
  publish: (w: BrowserWindow) => Promise<boolean>;
  /** An expression that is truthy once the post went through. */
  done: string;
}

const pageText = (pattern: RegExp): string => `${pattern.toString()}.test(document.body ? document.body.innerText : '')`;

const FLOWS: Record<SocialPlatform, Flow> = {
  tiktok: {
    async prepare(w, draft, say) {
      await say('Opening TikTok Studio…');
      await load(w, 'https://www.tiktok.com/tiktokstudio/upload');
      if (!(await waitFor(w, `!!document.querySelector('input[type="file"]')`, 30))) throw new Stuck('The upload page did not show its file picker.');
      await say('Uploading the video…');
      if (!(await chooseFile(w, 'input[type="file"]', draft.video))) throw new Stuck('Could not hand the video to the upload page.');
      if (!(await waitFor(w, `!!document.querySelector('.public-DraftEditor-content, [contenteditable="true"]')`, 120))) throw new Stuck('The caption box did not appear.');
      await settle(w);
      await say('Writing the caption…');
      if (!(await typeCaption(w, '.public-DraftEditor-content, [contenteditable="true"]', draft.caption))) throw new Stuck('Could not write the caption.');
      await say('Waiting for TikTok to finish processing…');
      // The Post button is enabled once the upload is done.
      const ready = await waitFor(w, `(() => { const el = document.querySelector('[data-e2e="post_video_button"]') || ${byText(['post'])}; return !!el && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !${pageText(/Uploading/)}; })()`, 900);
      if (!ready) throw new Stuck('The upload did not finish within 15 minutes.');
    },
    async publish(w) {
      const clicked = (await w.webContents.executeJavaScript(`(() => { const el = document.querySelector('[data-e2e="post_video_button"]') || ${byText(['post'])}; if (!el || el.disabled) return false; el.click(); return true; })()`)) as boolean;
      // TikTok may ask once more while it checks the content.
      if (clicked) await clickText(w, ['post now'], 6);
      return clicked;
    },
    done: `location.pathname.startsWith('/tiktokstudio/content') || ${pageText(/(video|post) (has been|was|is being) (uploaded|posted|published)|Manage your posts/i)}`,
  },
  instagram: {
    async prepare(w, draft, say) {
      await say('Opening Instagram…');
      await load(w, 'https://www.instagram.com/');
      if (!(await clickText(w, ['new post', 'create'], 20))) throw new Stuck('Could not find the Create button.');
      // Newer layouts ask what to create, in a menu. Only look there: the feed has “Post” buttons for comments.
      await clickText(w, ['post'], 4, `document.querySelector('div[role="dialog"], div[role="menu"]')`);
      if (!(await waitFor(w, `!!document.querySelector('div[role="dialog"] input[type="file"], input[type="file"][accept*="video"]')`, 20))) throw new Stuck('The new-post dialog did not show its file picker.');
      await say('Uploading the video…');
      if (!(await chooseFile(w, 'div[role="dialog"] input[type="file"], input[type="file"][accept*="video"]', draft.video))) throw new Stuck('Could not hand the video to Instagram.');
      // “Video posts are now shared as reels”.
      await clickText(w, ['ok'], 8, `document.querySelector('div[role="dialog"]') || document`);
      for (const step of ['crop', 'edit']) {
        if (!(await clickText(w, ['next'], 60, `document.querySelector('div[role="dialog"]') || document`))) throw new Stuck(`Could not get past the ${step} step.`);
        await settle(w);
      }
      await say('Writing the caption…');
      const box = 'div[role="dialog"] [contenteditable="true"][role="textbox"], div[aria-label="Write a caption..."]';
      if (!(await waitFor(w, `!!document.querySelector(${JSON.stringify(box)})`, 30))) throw new Stuck('The caption box did not appear.');
      if (!(await typeCaption(w, box, draft.caption))) throw new Stuck('Could not write the caption.');
    },
    publish: (w) => clickText(w, ['share'], 10, `document.querySelector('div[role="dialog"]') || document`),
    done: pageText(/(reel|post) (has been|was) shared|Reel shared|Post shared/i),
  },
};

/**
 * Post a draft. The user pressed Post (and confirmed). `manual` stops before the final click so they press Post in the
 * window themselves; it is always on for videos with AI-generated content, whose label the user sets there.
 */
export async function post(id: string, caption: string, manual: boolean): Promise<void> {
  const draft = (await readDrafts()).find((d) => d.id === id);
  if (!draft) throw new Error('That draft no longer exists.');
  if (draft.status !== 'draft' && draft.status !== 'failed') throw new Error(draft.status === 'posted' ? 'This video was already posted.' : 'This video is already being posted.');
  if (!existsSync(draft.video)) throw new Error(`The video is gone: ${draft.video}`);
  const limit = CAPTION_LIMITS[draft.platform];
  if (caption.length > limit) throw new Error(`The caption is ${caption.length} characters; ${PLATFORMS[draft.platform].label} allows ${limit}.`);
  if (!(await signedIn(draft.platform))) throw new Error(`Sign in to ${PLATFORMS[draft.platform].label} first (Accounts & rules).`);
  const stopBeforePost = manual || !!draft.aiGenerated;
  await update(id, { caption, status: 'posting', progress: 'Waiting for the Social window…' });

  // In the background: the UI follows along through the status updates.
  void exclusive(async () => {
    const flow = FLOWS[draft.platform];
    const w = browser();
    w.show();
    setPosting(true);
    const say = async (progress: string): Promise<void> => void (await update(id, { progress }));
    const label = PLATFORMS[draft.platform].label;
    try {
      try {
        await flow.prepare(w, { ...draft, caption }, say);
        if (stopBeforePost || !(await flow.publish(w))) {
          throw new Stuck(stopBeforePost
            ? draft.aiGenerated
              ? `Ready. Turn on ${label}’s AI-generated content label, then press Post in the window.`
              : 'Ready. Check it in the window and press Post there.'
            : 'Could not find the Post button.');
        }
        await say('Posting…');
      } catch (error) {
        if (!(error instanceof Stuck)) throw error;
        // The user takes it from here, in the window. The caption is on the clipboard in case the page lost it.
        clipboard.writeText(caption);
        w.show();
        w.focus();
        const finishing = error.message.startsWith('Ready.');
        await update(id, { status: 'waiting', progress: finishing ? error.message : `${error.message} Finish in the window: the caption is on your clipboard.` });
      }
      const ok = await waitFor<boolean>(w, flow.done, 30 * 60);
      if (!ok) throw new Error('No confirmation from the page within 30 minutes. Check your profile: it may have been posted.');
      await update(id, { status: 'posted', posted: new Date().toISOString(), progress: undefined });
      await logVisit({ url: w.webContents.getURL(), by: 'you', result: 'opened', note: `Posted ${path.basename(draft.video)} to ${label}` });
    } catch (error) {
      await update(id, { status: 'failed', progress: (error as Error).message });
      await logVisit({ url: w.webContents.getURL(), by: 'you', result: 'failed', note: `Posting: ${(error as Error).message}` });
    } finally {
      setPosting(false);
      changed();
    }
  });
}
