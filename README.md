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
.cutroom/    timeline.json, graphics, transcripts, chat — everything Cutroom generates
```

**The edit is one file,** `.cutroom/timeline.json`: a main track of clips back to back; layers on top
(b-roll, picture-in-picture, cutouts, graphics) that can overlap freely; audio underneath. Clips and layers
can be cropped, sped up or slowed, faded and colour graded (per item or for the whole video). Claude writes it, the Pro timeline edits it, and the app re-renders the preview whenever
it changes. `cutroom render` turns it into a video with a single FFmpeg filter graph.

**Script first.** For a new video Claude looks at the footage and writes a script (`.cutroom/script.md`):
concept, shot list, sound. You adjust it in the chat and press **Approve & create video**; only then is
anything cut. The **Footage** button in the chat lets you pick the clips Claude should use.

**Two interfaces, one switch.** *Simple* is the preview and the chat: mark a frame or a section, say what
should change. *Pro* adds the editor: a media bin to add files, a timeline to move, trim, split, duplicate and reorder
(with snapping, undo and the usual shortcuts), an inspector for position, speed, volume, fades, crop and
colour, and a button to mark an item for Claude.

**Styles are skills.** `skills/` holds the built-in library (talking-head short, podcast clip, product
teaser, montage, explainer) as a Claude Code plugin. When you like a result, **Save style** has Claude
distil it into a new skill in `~/.cutroom/library/skills/`, which then shows up in the style picker for
every project.

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
  each with one API key. They supply generated stills and b-roll, lip sync and cutouts (`cutroom generate`, the
  `generate` skill; Theta through its MCP server); OpenRouter and Alibaba can also run the editor instead of Claude.
- **Codex** — sign in with your ChatGPT account; Claude can then hand tasks to Codex (bundled, runs as an MCP server).
- **MCP servers** — any other command or URL.

Settings are stored encrypted in `~/.cutroom/settings.enc`; a project's model choice in `.cutroom/project.json`.

## Code map

```
src/shared/types.ts   Timeline format and the window.cutroom API
src/shared/features.ts  Connections, features and how each is paid for
src/cli/              The `cutroom` command the agent calls: render, transcribe, remotion, generate
src/main/             Electron shell: project folders, tool setup, preview, the agent session
  prompt.ts             what the agent knows about editing in Cutroom
  settings.ts           accounts, models, providers, MCP servers
src/renderer/         React UI: Home, Settings, Chat, Preview, Timeline (+ Inspector, timelineOps)
skills/               Built-in editing styles
```

The agent runs shell commands and edits files in the project folder without asking for each one. It loads
only Cutroom's own instructions and skills, not your personal Claude Code settings.
