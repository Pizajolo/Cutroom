# Cutroom

A chat-first video editor for macOS. You open a folder of raw footage, tell Claude what you want, and
point at the frames you like or don't like. Claude does the editing with real tools — FFmpeg, Whisper,
HyperFrames, Remotion and yt-dlp — through the [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview).

## Run it

```sh
npm install
npm run dev        # or: npm run build && npm start
```

Requires Node 22+ and a Claude login: Home › Settings shows whether Claude Code is signed in, and lets you
sign in or use an Anthropic API key instead.

On first launch Cutroom checks its toolbox and installs what is missing:

| Tool | Used for | Where it comes from |
| --- | --- | --- |
| FFmpeg / ffprobe | cuts, compositing, exports | `PATH`, else `brew install ffmpeg` |
| Whisper (`whisper-cli` + `base` model) | transcripts, caption timing | `PATH`, else `brew install whisper-cpp`; model downloads to `~/.cutroom/models` |
| yt-dlp | downloading reference videos from links | downloaded to `~/.cutroom/bin` |
| Cutout and PDF helpers | subject cutouts; brand guideline pages | compiled from `native/` with Apple's command line tools |
| HyperFrames, Remotion | motion graphics and captions | npm dependencies |

Remotion needs a [company licence](https://www.remotion.dev/license) for some teams; HyperFrames is the default.

## How it works

**A project is a folder.** Opening one creates four subfolders, and loose media in it is sorted into them:

```
raw/         source footage (never modified)
references/  videos you like — inspiration, never copied
assets/      logos, images, music
exports/     finished videos
.cutroom/    everything Cutroom generates: transcripts, sources, and cuts/<id>/ per chat
             (timeline.json, graphics, storyboard, chat, versions)
```

**Several chats, one footage.** A project holds any number of chats (the tabs above the chat), and each has its own
edit, so one set of raw footage can become a 60 s cut, a 15 s teaser and a vertical version. **Split from here**
under any reply starts a new chat from that point: Claude remembers the conversation up to there, the edit goes back
to how that reply left it, and graphics, cutouts and voice-over are copied, so the two chats never change each other's
files. Make the video once, split, and ask for German subtitles. Exports are named after the chat
(`exports/trip-German-01.mp4`); the first chat keeps the plain name.

**The edit is one file per chat,** `.cutroom/cuts/<id>/timeline.json`: a main track of clips back to back; layers on top
(b-roll, picture-in-picture, cutouts, graphics) that can overlap freely; audio underneath. Clips and layers
can be cropped, sped up or slowed, faded and colour graded (per item or for the whole video). Claude writes it, the Pro timeline edits it, and the app re-renders the preview whenever
it changes. `cutroom render` turns it into a video with a single FFmpeg filter graph.

**Sound that sits right.** A music bed marked `"duck": true` dips under speech (about 10 dB, or the dB you set) and comes
back up in the pauses; the dip is the same for a quiet speaker as for a loud one. Every render is levelled to -14 LUFS
with peaks under -1 dBTP, what TikTok, Reels, Shorts and YouTube play at (`"loudness"` on the timeline sets another
target, `false` turns it off). Levelling is measured, then applied as one steady gain change, so nothing pumps.

**Checked before you see it.** `cutroom check` is the technical pass Claude runs before replying: flashes of black,
frozen picture, dead air, a silent first second, loudness and peaks, and layers that run past the end or are never
seen, each with its time. Held titles and still images are recognised as meant.

**Storyboard first.** For a new video Claude looks at the footage and writes a storyboard (`script.md` in the chat's folder):
concept, three hook options, a shot list with a real frame per shot, sound. You pick a hook, adjust it in the chat and
press **Approve & create video**; only then is anything cut. Each shot names its *technique*: before writing the
shots Claude runs `cutroom recall` with one line per beat ("I name three tools; each appears as I say it"), which finds
the moves in your library, the built-in ones and those from the marketplace that fit, and ranks moves used in your last
few projects lower, so videos don't all look alike. Claude loads the candidates, borrows one only where it serves the
shot, and labels the rest **New move**; after an export it offers to save those to your library. Your own picks always
come first, and "don't use my library" turns it off.

**No footage yet? Script first.** Start with an idea, a rough draft or a reference you like, and Claude writes a script
to record instead of a storyboard: hook options, the words to say in short spoken lines with on-screen cues, and the
shots to record. **Teleprompter** under the script shows it large and scrolling (speed, size, mirror for teleprompter
glass, Space to pause); **Approve script** sends you off to record. Once the footage is in, the script is the storyboard
and Claude goes straight to the spoken cut, telling you which lines are missing. Corrections that apply to every script
("I never say 'game-changer'") go into `~/.cutroom/library/voice.md`, so the next script starts in your voice. For footage where someone talks, Claude first builds the
**spoken cut** — best takes, no dead air, nothing else — and waits for **Approve spoken cut** before adding visuals.
**Add files** copies files into the folder you pick (or sorts them by type) and downloads videos from pasted links —
TikTok, Instagram Reels, YouTube — with yt-dlp. The **Footage** button in the chat lets you pick the clips Claude should use.

**Versions.** Every step of Claude's that changed the edit and every export is kept, per chat (`versions.json`). The
**Versions** button lists them; go back to any, or mark one as final. Under each reply, **Go back to before this** does
the same for one step.

**Two interfaces, one switch.** *Simple* is the preview and the chat: mark a frame or a section, say what
should change. Each mark gets its own note, so you can watch through once, leave a note at every spot, and send them
together; Claude answers each one. Under each reply that changed the edit, **Go back to before this** restores the earlier version. *Pro* adds the editor: a media bin to add files, a timeline to move, trim, split, duplicate and reorder
(with snapping, undo and the usual shortcuts), an inspector for position, speed, volume, fades, crop and
colour, and a button to mark an item for Claude.

**The library: styles and moves.** Both are skills. A *style* is how a whole video is made (`skills/` ships
talking-head short, podcast clip, product teaser, montage, explainer); a *move* is one technique — word-by-word captions,
a punch-in, a kinetic title — usable in any video. **Save style** has Claude distil a finished edit into a style *and*
its moves in `~/.cutroom/library/skills/`; mark a section (or name a moment in a reference) and ask to save just that
move. Each keeps an example clip. Home › Library filters by kind, tags and text, lets you star favourites (listed first when picking in a project), plays the examples, lists every video
exported with an entry and lets you edit its instructions. In a project, **Styles & moves** picks several for a
request; click a picked one to mention it (`@punch-in`) and say where it goes.

**Brand kits: how a video looks and sounds.** A style says how a video is cut; a brand kit says what it looks like:
logos (full, icon, for dark backgrounds), watermark, end card, colours, heading and caption fonts (uploaded or by name),
text sizes, caption style, music tracks or a mood, sound effects, a LUT, transitions and energy, voice-over voice,
language and tone, format and length, and free notes. Home › Brand kits lists them; each opens as a form, saved as you
type, next to a live preview of a frame and the end card. Claude sits in a bubble in the lower right corner: it opens
into a chat over the page that shows each step it takes, and the form and preview change as it fills in the kit from
your website or a few words, or adjusts it ("warmer colours", "captions in capitals"). **Attach** (or drop anywhere on
the page) a brand guideline PDF, a video in the brand's style, a link to one, or pictures, and Claude takes everything
the kit can hold from them: it reads the PDF (and renders pages with a small PDFKit helper compiled on first launch,
`native/pdfpage.swift`), watches the video's frames and measures its cuts, listens to it with Whisper, and cuts logos out
of a page or an end card. It never takes music, footage or voice from a video. It can only read web pages and your
attachments and change that kit (values and logos; never your uploaded files); one conversation per kit, kept with its
attachments in the kit's folder (`.chat/`). **Layout studio** (Brand kits › a kit › Layout, or click the preview): drag and resize the title, subtitle, captions,
logo and handle tag in a frame and set their size, alignment, colour, letter case and italics. TikTok's, Instagram
Reels' and YouTube Shorts' own interface — tabs, the like/comment/share column, the name, caption and sound — can be
drawn on top, and what they cover is shaded; anything under it, or two elements on top of each other, is listed, and
**Move into the safe area** fixes it. Positions are fractions of the frame (`layout` in brand.json), so they hold in
every format; the kit's caption position, watermark corner and text sizes follow from them. The editing agent gets
the exact boxes and the area to keep clear, the brand guidelines a layout page, and Claude's `update_kit` checks every
layout change against the apps (the zones are approximate: `PLATFORMS` in `src/shared/brand.ts`).
**Logo studio** (Brand kits › a kit › Logo studio): a chat in which Claude draws the logo as SVG — a clean vector
redraw of the one there is, or new designs from a description or an attached sketch — with every version beside the
chat. Claude renders a proof of each version (on white, black and the brand colour, at 64 and 32 px), looks at it and
fixes what is off before it answers. Lettering is set with real font outlines (the kit's fonts, or any free font,
via fontkit), so the logo needs no installed font; detailed artwork can be traced (imagetracerjs) and then cleaned up.
**Use as** puts a version into a logo slot as an SVG with a transparent PNG beside it, for tools that cannot read SVG.
Rendering and tracing run in a hidden Chromium page (`src/main/raster.ts`), so no native image library is needed.
**Fonts:** a family typed in the form is looked up in the free font libraries (Google Fonts and the other
open-licensed families Fontsource lists, about 2,100); a free one downloads into the kit as a .ttf with its licence
recorded, so graphics and captions never depend on what is installed. For a paid font the form says so and offers free
look-alikes (Helvetica → Inter, Futura → Jost, …); upload the file to use the real one. Claude downloads fonts the same
way when it sets them. The list of free fonts is kept in `~/.cutroom/fonts-index.json` and refreshed weekly.
**Export** saves a kit as brand guidelines — a designed PDF manual (cover, logos,
palette with HEX/RGB/CMYK, type specimens, captions, motion, sound and voice, do's and don'ts) or the same as Markdown —
or as a brand package (.zip: the kit and its files, both documents, and `tokens.css`/`tokens.json` design tokens).
**Import** on the Brand kits page (or dropping the .zip there) turns a package back into a kit.
The pencil on a logo opens the logo editor: remove a background colour (only what touches the edge, or holes too) or
lift the logo off a photo with Apple Vision, crop by dragging or trim to the logo, zoom, and recolour (all one colour,
swap a colour, black and white, inverted), judged on transparent, dark, light or the brand colour, and saved into any
logo slot — e.g. a white version for dark backgrounds. In a project, the brand menu at the top of the chat
sets the kit for that chat only. A new chat starts with the kit of the open one, and **Split from here** keeps it, so
split a finished video and pick another kit to make the same video for another brand. Claude gets the kit with every
message and is told when it changes; on a chat that already has an edit, **Restyle now** asks it to apply the new kit
right away. Ask in a chat to save the look of an edit as a brand kit (the `save-brand` skill). Kits live in
`~/.cutroom/library/brands/<id>/` (`brand.json` and the files); the chat's kit is in `cuts.json`.

**The Skill Marketplace.** Home › Marketplace finds styles and moves made by other editors: search, filter by kind,
price and tags, watch the example clips, read the instructions and reviews. **Sign in with Google** opens your browser;
approve there and the app is connected (a revocable device token, stored encrypted in `~/.cutroom/market.enc` —
the UI never sees it). **Install** puts a skill in `~/.cutroom/market/skills/` — a third plugin next to the built-in
skills and your library, loaded by Claude but never writable by it — and it appears in the Library tagged *Marketplace*.
Installed skills show **Update** when a creator releases a new version, and a warning if moderators removed one.
Star favourites, rate and review what you installed, **Report** anything harmful, and **Buy** paid skills through
Stripe Checkout. To share your own, open it in the Library and press **Publish to marketplace** (free, or for a price
once payouts are set up on the website): the marketplace checks every version for malicious instructions and code and
shows the result right away — live, in review, or rejected with the reasons. `cutroom://install/<slug>` links on the
website open the skill in the app. Settings › Marketplace shows the account and, for a self-hosted marketplace, its
address (or set `CUTROOM_MARKET_URL`). The website, API and moderation live in the
[cutroom-market](https://github.com/pizajolo/cutroom-market) repository.

**Social analytics: your TikTok and Instagram.** Home › Social lets Claude read your own stats (followers, likes,
views, TikTok Studio and Meta Business Suite insights) and competitors' public profiles, in a browser window inside
Cutroom that you sign in to yourself. There's no API and no app review. **This breaks both platforms' terms**, and the
account carries the risk (captchas, re-logins, limits, suspension). The page says so and stays off until you accept
it. The sign-in lives in the window's own cookie store (`persist:social`), so it lasts like a browser session. **Save
login in Keychain** encrypts the user name and password with the Keychain-backed key (`~/.cutroom/social-logins.enc`).
Cutroom then signs in again by itself when the session expires, typing the login only into the platform's own sign-in
page. Claude never sees it. You answer two-factor codes and captchas yourself in the window.

You decide how Claude may use the window, and Cutroom enforces it, not Claude:
- **Platforms:** TikTok and Instagram, each on or off.
- **Pages:** your own profile and analytics, other profiles, single posts, and search or hashtags, each on or off.
  Messages, settings and feeds are always closed.
- **Competitors:** an optional list of the only accounts Claude may open.
- **Speed:** careful 12–25 s, normal 6–12 s or quick 3–6 s between page views.
- **Limits:** page views per message and per day.
- **Automatic check:** off, daily or weekly, while Cutroom is open.
- **Account analytics:** on by default, each check also reads the whole account’s numbers (views, profile views, reach, …) from TikTok Studio and, for Instagram, Meta Business Suite insights (needs a Facebook sign-in linked to the account). They show under Social › Account analytics and Claude sees them in the stats history.
- **Window:** whether it's shown while Claude works.

Claude gets read-only tools (`mcp__social__*`): open a page, read it, scroll, click a tab, take a screenshot, and save
or read follower counts. They refuse anything that acts as you: follow, like, comment, share, message or post. Every
page opened or refused is listed under Activity, and the counts build a follower history under `~/.cutroom/social/`.

**Posting.** The Social tab has three views: Overview, Accounts & rules, and Activity. Overview shows the follower
counts and posted videos next to a Claude chat of its own, which needs no open project. The posting flow:
1. **Pick videos:** choose exported videos (the `exports/` folders of recent projects) and ask for captions.
2. **Claude looks:** it pulls frames, transcribes speech, and reads the project's ledger for where footage and music
   came from.
3. **Claude proposes:** it calls `propose_post`, which puts a draft card in the chat with the video, an editable
   caption (checked against each platform's limit) and notes such as rights to check. **Claude has no tool that
   posts.**
4. **You post:** only your **Post to TikTok / Instagram** button and the confirmation after it do that. Cutroom
   uploads the video in the Social window (always shown while it works), types the caption and presses Post.
   - **"I'll press Post myself":** stops before that final click.
   - **AI-generated content:** if the ledger says the video has any, Cutroom always stops there, so you can set the
     platform's AI label.
   - **If a page looks different than expected** (a redesign, another language), Cutroom leaves the window at that
     step with the caption on the clipboard, and you finish by hand.

Cutroom marks a draft posted only when the page confirms it.

**Cutouts and stickers, on this Mac.** `cutroom cutout` lifts the subject out of a clip (a transparent `.mov`) or a
frame (a `.png`, optionally with a white sticker outline) with Apple's Vision framework: free, offline, no account.
It is a small Swift helper (`native/cutout.swift`) that Cutroom compiles on first launch, which needs Apple's command
line tools. Used for text behind the subject, new backgrounds and the `sticker` move. Features lets you switch
cutouts to a fal.ai model instead for difficult footage.

**Sources and rights.** Downloads, generated media and anything Claude brings in are recorded with source and licence
(`.cutroom/ledger.json`), shown under Project settings. HDR footage (iPhone HLG, HDR10) is converted to standard range
when rendering.

**Home** lists your projects and styles. **Features** shows every capability, where it comes from, whether it
is free, subscription or pay-per-use, and a switch for each; a project's **Project settings** button switches
features off for that project only. Claude is told exactly what is available and refuses the rest.

Settings:

- **Claude** — Claude Code sign-in or API key.
- **Models** — a default model, overridable per project from the bottom of the chat.
- **Other providers** — any Anthropic-compatible endpoint (OpenRouter, LiteLLM, a gateway); its models join the model lists.
- **ElevenLabs** — via API (Claude calls it with the `elevenlabs` skill) or via the official MCP server (needs `uvx`):
  voice-over, music, sound effects. Record yourself in Settings to clone your own voice; the voice you tick
  is the one Claude uses for voice-over.
- **Connections** — fal.ai, OpenRouter, Alibaba Cloud (pay-as-you-go, Coding Plan, Token Plan) and Theta EdgeCloud,
  each with one API key. They supply generated stills and b-roll, lip sync and, if you prefer a cloud model, cutouts (`cutroom generate`, the
  `generate` skill; Theta through its MCP server); OpenRouter and Alibaba can also run the editor instead of Claude.
- **Codex** — sign in with your ChatGPT account; Claude can then hand tasks to Codex (bundled, runs as an MCP server)
  and generate stills through ChatGPT's image tool (`codex:image`), with no API key.
- **MCP servers** — any other command or URL.
- **Marketplace** — Google sign-in to the Skill Marketplace, and its address.

Home › **Social** has the TikTok and Instagram sign-ins and the rules for Claude's access (see above).

Settings are stored encrypted in `~/.cutroom/settings.enc`; a project's model choice in `.cutroom/project.json`.

**Getting started guide.** On first launch, and at every start while no account is connected, a short guide asks you
to connect Claude (or ChatGPT, ElevenLabs and the other providers) and shows where everything is. Reopen it with
**Guide** on Home. If you send a message while no model is connected, the chat holds it back and offers
**Connect now**, which opens Settings in place.

**Updates.** At start Cutroom asks GitHub for the latest release of this repository
(`api.github.com/repos/Pizajolo/Cutroom/releases/latest`) and, if its tag (`v0.3.0`) is higher than the running
version (`version` in `package.json`), offers the download with the release notes as "What's new". To ship an update:
bump `version`, publish a GitHub release tagged `v<version>`, write the notes, and attach a `.dmg` if there is one
(otherwise the popup opens the release page). Drafts and pre-releases are ignored.

## Code map

```
src/shared/types.ts   Timeline format and the window.cutroom API
src/shared/features.ts  Connections, features and how each is paid for
src/shared/brand.ts   Brand kits: the format, defaults, and reading older or hand-written kits
src/shared/social.ts  Social analytics rules: platforms, page kinds, pace, which links Claude may open
src/cli/              The `cutroom` command the agent calls: render, check, recall, transcribe, remotion, cutout, generate, style-example, ledger
  loudness.ts           measuring and levelling the mix (EBU R128, two-pass)
  check.ts              the technical check of a render and of the edit behind it
  recall.ts             library moves that fit each storyboard beat
  project.ts            per-project settings, versions, sources, style ↔ video links
src/main/             Electron shell: project folders, tool setup, preview, the agent session
  cuts.ts               chats in a project: new, split, rename, and moving older projects into the first one
  prompt.ts             what the agent knows about editing in Cutroom
  brands.ts             brand kits: files, logos, what the agent is told and when the kit changed
  logoStudio.ts         the logo studio: Claude's drawing tools (show_logo, trace_image, text_outline, use_logo), versions
  chatRunner.ts         one saved Claude conversation (brand kit chat, logo studio): streaming, steps, sessions
  raster.ts             SVG to PNG, proof sheets and tracing in a hidden Chromium page
  logoText.ts           text as SVG outlines from a font file (fontkit)
  fonts.ts              free fonts: lookup, look-alikes for paid ones, downloads from Google Fonts and Fontsource
  brandExport.ts        brand guidelines (PDF via a hidden window, Markdown), design tokens, brand packages and import
  brandChat.ts          the Claude chat on a brand kit's page: attachments and its tools (update_kit, download_logo,
                        video_frames, video_still, transcribe_video, pdf_pages, save_logo, download_video)
  settings.ts           accounts, models, providers, MCP servers
  market.ts             Skill Marketplace: Google sign-in (loopback + PKCE), browse, install/update, reviews, publish
  social.ts             Social analytics: the signed-in browser window, saved logins, pace and limits, Claude's social tools
  socialPost.ts         Posting: exported videos, Claude's propose_post tool, the TikTok Studio and Instagram upload flows
  socialChat.ts         The Social tab's own Claude chat (no project needed)
  updates.ts            the check for a newer release on GitHub
src/renderer/         React UI: Home, Onboarding, Settings, Market, Brands (+ LayoutStudio, LayoutFrame, LogoStudio, LogoEditor, ClaudeBubble), Social (+ SocialChat), Chat, Preview (+ Teleprompter), Timeline (+ Inspector, timelineOps)
skills/               Built-in styles, moves and helper skills
native/cutout.swift   The cutout helper (Apple Vision), compiled on first launch into ~/.cutroom/bin
native/pdfpage.swift  Renders brand guideline PDF pages (PDFKit), compiled the same way
```

The agent runs shell commands and edits files in the project folder without asking for each one. It loads
only Cutroom's own instructions and skills, not your personal Claude Code settings.

## Licence

Copyright © OpenTheta AG. Cutroom is free software, licensed under the
[GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). The name "Cutroom" and its logo are not covered
by the licence. Third-party tools Cutroom uses or installs (FFmpeg, Whisper, yt-dlp, HyperFrames, Remotion, Codex, …)
keep their own licences. Use of the website and the Skill Marketplace is governed by the
[Terms of Service](https://cutroom.app/terms) and the [Privacy Policy](https://cutroom.app/privacy).
