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

**Storyboard first.** For a new video Claude looks at the footage and writes a storyboard (`script.md` in the chat's folder):
concept, three hook options, a shot list with a real frame per shot, sound. You pick a hook, adjust it in the chat and
press **Approve & create video**; only then is anything cut. For footage where someone talks, Claude first builds the
**spoken cut** — best takes, no dead air, nothing else — and waits for **Approve spoken cut** before adding visuals.
**Add files** copies files into the folder you pick (or sorts them by type) and downloads videos from pasted links —
TikTok, Instagram Reels, YouTube — with yt-dlp. The **Footage** button in the chat lets you pick the clips Claude should use.

**Versions.** Every step of Claude's that changed the edit and every export is kept, per chat (`versions.json`). The
**Versions** button lists them; go back to any, or mark one as final. Under each reply, **Go back to before this** does
the same for one step.

**Two interfaces, one switch.** *Simple* is the preview and the chat: mark a frame or a section, say what
should change. Under each reply that changed the edit, **Go back to before this** restores the earlier version. *Pro* adds the editor: a media bin to add files, a timeline to move, trim, split, duplicate and reorder
(with snapping, undo and the usual shortcuts), an inspector for position, speed, volume, fades, crop and
colour, and a button to mark an item for Claude.

**The library: styles and moves.** Both are skills. A *style* is how a whole video is made (`skills/` ships
talking-head short, podcast clip, product teaser, montage, explainer); a *move* is one technique — word-by-word captions,
a punch-in, a kinetic title — usable in any video. **Save style** has Claude distil a finished edit into a style *and*
its moves in `~/.cutroom/library/skills/`; mark a section (or name a moment in a reference) and ask to save just that
move. Each keeps an example clip. Home › Library filters by kind, tags and text, lets you star favourites (listed first when picking in a project), plays the examples, lists every video
exported with an entry and lets you edit its instructions. In a project, **Styles & moves** picks several for a
request; click a picked one to mention it (`@punch-in`) and say where it goes.

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

Settings are stored encrypted in `~/.cutroom/settings.enc`; a project's model choice in `.cutroom/project.json`.

## Code map

```
src/shared/types.ts   Timeline format and the window.cutroom API
src/shared/features.ts  Connections, features and how each is paid for
src/cli/              The `cutroom` command the agent calls: render, transcribe, remotion, cutout, generate, style-example, ledger
  project.ts            per-project settings, versions, sources, style ↔ video links
src/main/             Electron shell: project folders, tool setup, preview, the agent session
  cuts.ts               chats in a project: new, split, rename, and moving older projects into the first one
  prompt.ts             what the agent knows about editing in Cutroom
  settings.ts           accounts, models, providers, MCP servers
src/renderer/         React UI: Home, Settings, Chat, Preview, Timeline (+ Inspector, timelineOps)
skills/               Built-in styles, moves and helper skills
native/cutout.swift   The cutout helper (Apple Vision), compiled on first launch into ~/.cutroom/bin
```

The agent runs shell commands and edits files in the project folder without asking for each one. It loads
only Cutroom's own instructions and skills, not your personal Claude Code settings.
