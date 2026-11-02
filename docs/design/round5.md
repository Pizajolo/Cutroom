# Usable projects, settings and connected tools

Implementation supplement, 2026-11-02. Applies to F1/F4/F8/F9 and their backend contracts. This supersedes the three-step project/team/run wizard in spec §13 for this round, the future-only Audio copy in settings-connections.md, and the old assertion that ElevenLabs has no optional hosted MCP connection. Other editor, account-security and component rules remain unchanged. All mockup data is fictional.

## 1. Visual plan and review

Continue the macOS editing desk: graphite `#191c20`, panel slate `#23272d`, primary text `#e8edf2`, secondary text `#b4bec9`, steel-blue action `#9cc8ef`, recovery amber `#e3bf7a`. Use existing success/danger tokens for actual results, not provider branding. System sans throughout; tabular numerals for sizes/fps/times, monospace only for commands and literal paths. Lucide outline icons, 16 px, offline. No new colour values or font dependencies.

The memorable structural feature is **a visible boundary between source material, editable project state and external tools**: read-only Folder root, an explicit copy into Footage, review-before-install, and a Terminal sign-in handoff. Reject a new dashboard of matching tiles: projects need scannable rows, settings need labelled controls, and risky operations need a concrete review sheet. Surfaces and geometry reuse existing tokens.

```text
Projects: 176 navigation | 32 inset, heading + Open project / New project
                        | recent-project rows, name / format / last opened / Open

Settings: 176 navigation | 200 section navigation | 24 inset, content max 880
                                                | section controls / save status
                                                | consequential action review dialog

Home: 176 navigation | centred column max 760, contents left aligned
                    | goal / microphone
                    | project selector                         Start
                    | selected project's path / prerequisite message
```

At <1280 px the app sidebar becomes a 56 px rail. At ≤700 px Settings section navigation wraps above the content; compound form rows stack. Dialogs use max-width `calc(100vw - 48px)`, max-height `calc(100dvh - 48px)` with scrolling body and pinned actions. No horizontal document scrolling. Dense desktop controls are 28 px high; use ≥36 px for touch-oriented narrow screens. Plain-language labels are always visible, not placeholder-only.

## 2. Shared settings behaviour

Seven sections, in order: Accounts, Tools, Sandbox, Voice input, Render presets, Storage / snapshots, Extensions. Preserve the existing two navigation columns and section scroll position when practical. None of the five new sections is an Unavailable placeholder. Individual unavailable prerequisites show their specific reason and a link to the relevant section; unrelated controls stay usable.

- Load from settings.get; subscribe to settings.changed before fetching. Never replace a newer event with an older response. While loading, show “Loading settings…” rather than invented defaults.
- Sandbox, Voice input and snapshot-retention controls use a section-local draft with **Save changes** and **Discard**. Action row sits after the form, not fixed over content. Save disabled when unchanged or invalid. While saving: “Saving…”; disable repeated submission. Success: “Saved”, polite announcement. Failure: inline Notice, retain draft and Retry; never falsely mark saved.
- Section change with dirty draft: 440 px dialog **“Save changes before leaving?”**, **Keep editing** (initial focus), **Discard changes**, **Save changes**. Save then navigate only on success. Snapshot creation, cleanup and extension toggles are independent operations, not silently included in a settings draft.
- Native radios, checkbox/switch semantics, selects and labelled number fields. Switches are 32×18 px, entire label row clickable, minimum 28 px target, on/off text available to assistive tech. Checked fills accent, thumb uses text-on-accent; unchecked uses strong border. Focus ring 2 px / offset 2 px. Do not style a disabled control as saved/enabled.
- Form group gap 24 px, label-to-control 8 px, helper gap 4 px; section divider 1 px with 20 px vertical spacing. Form content max 880 px; prose max 70 characters. Setting rows min 52 px, top-aligned labels with wrapping help. Avoid extra card borders around every individual setting.
- Errors use text+icon and `aria-describedby`; submit error summary links invalid fields. Unknown byte counts/limits/status show “Unavailable”, not zero. Settings update requests contain validated non-secret patches only.

## 3. Sandbox

Intro: **“Control which tools Claude can use in this project. Your source media stays protected.”**

A neutral scope inset, lock icon and heading **“Protected project files”**:

> Agents can write compositions/ and work/. Footage, references, assets and Folder root files are read-only. Timeline changes go through Cutroom's editing tools and can be undone.

Do not imply an extension is fully constrained merely because its requested scopes are displayed; see §7.

| Control | Default / helper | Behaviour |
|---|---|---|
| Network for sandboxed commands | **Off by default**, lock icon and noninteractive text | Never offer an “Always allow network” toggle; networkByDefault:true is rejected |
| Allow shell commands in the sandbox | Off unless saved on | Helper: “Allows Claude to run commands. Source media remains read-only; command network access is restricted to the allowed domains below.” |
| Allow web search and fetch | Off unless saved on | Helper: “Searches and fetched pages are processed externally. This does not give shell commands unrestricted network access.” |
| Allowed domains | Input “example.com”, Add, wrapping list with named Remove buttons | Hostnames only, max 50; case-normalise, trim whitespace, no schemes, paths, ports or wildcards unless the backend explicitly supports them |

Domain invalid example: **“Enter a hostname, such as example.com, without https:// or a path.”** Duplicates: **“This domain is already allowed.”** Do not clear invalid input. Adding/removing edits the local draft; Save changes persists the list. Empty list: **“No domains allowed for sandboxed commands.”** Keep the domain list visible even if shell is off so saved policy is inspectable.

When enabling shell or broadening domains, Save opens a 440 px review **“Allow these sandbox tools?”** showing the changed flags and added domains, **Cancel** initial focus / **Save sandbox settings**. Restrictive changes do not need a second confirmation. Clarify beneath: **“Built-in imports and enabled service integrations use their own explicit permissions.”** Don't promise this switch disables yt-dlp or ElevenLabs API calls.

## 4. Voice input

Intro: **“Turn a microphone recording into text. Nothing is sent as a message until you choose Send or Start.”** Engine fieldset:

- **Local Whisper**, helper “Processed on this Mac.” Installed-model select only; show selected model and its installed state. Missing whisper-cli: warning **“Whisper needs a local build before voice input can run.”** with exact tools hint and **Open Tools**. No installed models: disabled “Choose a model after downloading one” plus Open Tools. Keep any unavailable saved model visible as a note; never silently substitute.
- **ElevenLabs Scribe**, **External processing** badge. Helper **“Recordings are sent to ElevenLabs for transcription.”** Disabled when account not connected, explanation **“Connect ElevenLabs in Accounts to use Scribe.”** + **Open Accounts**. A failed account check is not proof of disconnection; show safe status error and recheck.

Model is applicable only to Whisper. Save validates the selected engine's actual prerequisites. Do not silently fall back from local processing to Scribe on a failed recording.

**Test microphone** appears beneath the saved configuration once voice.transcribe is available. It never sends a message. Engine name is visible before capture. Idle → **Listening · 00:07** with **Stop recording** / **Discard** → **Transcribing with Local Whisper…** → read-only result labelled **“Test transcript”**. Use a recording icon+text, not a red dot alone. Stop all stream tracks on stop/discard/unmount/error; cap at 10 MB and stop with **“Recording limit reached. Transcribing the recording…”**. Escape during capture discards this recording, not existing composer text. This round records then transcribes; it does **not** promise continuous silence-triggered chunks from spec §14.

OS denial: **“Microphone access is off. Allow Cutroom in System Settings → Privacy & Security → Microphone, then try again. You can keep typing.”** Error retains any typed text. Transcription failure retains draft text, offers Record again, and does not send audio again automatically. Test input/result is not persisted in settings.

## 5. Render presets

Intro: **“Choose the default export format or save your own. Exports use the next available version in final/.”**

Default preset select lists built-ins and custom presets from export.presets. Selection persists on Save changes. Table/list: **Preset**, **Video**, **Frame size / fps**, **Actions**; rows ≥56 px, selected/default adds a text badge, built-ins add **Built-in**. Built-ins are immutable: **View** opens read-only details; **Duplicate** starts a new custom draft. Custom rows offer Edit and Delete. No animation preview or fake test render.

Built-in labels: Draft 720p; H.264; HEVC; ProRes 422 HQ; YouTube; Reels / TikTok; LinkedIn. Show actual returned codec, size, fps and quality. Don't infer compatibility or performance from a name.

**New preset** / Edit opens a 640 px form dialog:

1. Name (required, max according to schema).
2. Container MP4 / MOV; video codec H.264 / HEVC / ProRes. Offer supported combinations only. If changing codec resets inapplicable quality fields, visibly explain before committing; no hidden lossy conversion of existing values.
3. Quality: CRF or Bitrate (kb/s), only when codec supports it. Label units, integer input and validated bounds from schema. ProRes uses its supported profile, not a fake CRF slider.
4. Frame size: **Use project size** / **Custom**, width × height in output px. Fit **Fit with padding** / **Fill and crop**. Frame rate: **Use project fps** / numeric fps.
5. Audio: codec and read-only normalization summary **−14 LUFS integrated / −1 dB true peak** when these are the contract's supported values. Don't expose controls the backend ignores.

Footer Cancel / **Save preset**. Errors stay alongside fields; save returns to list with the created row focused. **Delete preset?** confirmation names preset. A default custom preset cannot be deleted: **“Choose a different default before deleting this preset.”** with default-selector link; no silent default replacement. Deleting a preset never deletes an existing export.

## 6. Storage / snapshots

Intro: **“See what uses space and remove generated files. Source media and finished exports are never included in cleanup.”**

Usage table columns **Location**, **Used**, **Cleanup**. Rows supplied by storage.usage: Tools, Models, Caches, Project preview cache (`work/.cutroom-media`), Job logs (`work/logs`), Snapshots, Finished exports (`final/`). Sizes decimal MB/GB, tabular. Mark Tools **Managed in Tools**, Models **Manage models**, final/ **Never cleaned here**. No project: retain global usage; project rows say **“Open a project”** and project actions disabled with reason. Never offer source-media, installed-tool or model deletion in the cleanup dialog.

### Exact cleanup review

1. **Review cleanup** opens a 560 px dialog with checkboxes for only backend-supported cleanable categories. Start unchecked. Help notes regenerated previews and logs; snapshots are recovery points. **Preview cleanup** calls storage.cleanPreview. It deletes nothing.
2. Replace body with **“Review files to remove”**, count, bytes and exact relative item list from the returned token. Scroll the list, not the footer. Paths wrap, never truncate the only identifying part. Highlight snapshots as **Recovery point**. Show **“Footage, references, assets and finished exports will be kept.”**
3. Cancel initial focus / **Remove N items** destructive; send only the preview token to storage.clean. No extra paths and no renderer-invented contents. While deleting: “Removing…”, disable repeat.
4. Expired/consumed token: **“This cleanup preview expired. Review the current files before removing anything.”**, **Review again**; never automatically renew then delete. Partial failure reports actual outcome and refetches usage; no all-success toast.
5. Success: **“Removed N items.”** Show bytes freed only if returned/reliably established by the service, not optimistic prediction. Refetch usage and snapshots.

### Snapshot policy and list

Retention fields **Keep snapshots for [N] days**, **Maximum snapshot storage [N] GB**, helpers clarify conversion to maxBytes and actual supported bounds. Checkboxes **Before Claude edits** / **Before export**. Helper **“The newest snapshot is kept when retention cleanup runs.”** Save local policy through settings.update. Do not imply a snapshot backs up every media file.

Current project section: **Snapshots**, **Create snapshot**, list columns **Label**, **Created**, **Size** when available, **Actions**. Empty: **“No snapshots yet. Create one before making a large change.”** Loading/error distinct. Create opens 440 px label form (placeholder “Before recut”), Create snapshot; success inserts actual record.

**“Restore ‘Before recut’?”** body **“This restores the saved timeline. It doesn't replace source media or finished exports. You can undo the timeline restore.”** Show timestamp, **Cancel** initial focus / **Restore snapshot**. On success refetch timeline/snapshot state; toast links **Undo** only when timeline.undo is available. The B2 restore operation is timeline-only even though snapshots retain a project.json copy; do not promise project-settings or full-file restoration.

**“Delete snapshot?”** names label/time, **“This recovery point will be permanently removed. Your current edit won't change.”** Cancel / Delete snapshot. Retention never appears to delete finished exports.

## 7. Extensions

Intro: **“Choose the tools available to Claude. Adding a server can give that server access to your files or external services.”** Built-ins first, custom servers second. Each row min 72 px, name13 semibold, description12, status text+icon and toggle at right. Row detail expands without navigating away. Toggle saves directly with pending state; don't turn it on visually before confirmation succeeds. All failures belong to their own row.

| Built-in | Status / controls | Scope copy |
|---|---|---|
| Cutroom editor | **Always on**, locked, no fake toggle | “Project, media and timeline tools. Source files are protected.” |
| ElevenLabs | Toggle; blocked reason + Open Accounts when no key | “Uses your saved ElevenLabs API key for voices, audio generation and transcription.” |
| Codex | Toggle; **Codex CLI not found** / **Sign-in required** / **Ready**; Open Accounts | “Claude can ask Codex for a read-only analysis. Codex cannot change this edit.” |
| ElevenLabs hosted MCP | **Experimental**, off by default, separate toggle | “Optional hosted connection with its own sign-in. Not required for the built-in ElevenLabs tools.” |

Hosted MCP does not inherit the API-key Connected badge. Status is its actual MCP state: Disabled, Connecting, Ready, Needs sign-in, Unavailable, or returned safe error. Enabling it is not signing in. If the SDK exposes no approved sign-in handoff, say **“Hosted sign-in isn't available in this build. Use the built-in ElevenLabs connection instead.”** Do not embed an OAuth page, store tokens, invent an authorize URL or advertise a working Sign in button without the backend flow. No speculative API support/capability badges.

### Add MCP server: edit → review → install

**Add MCP server** opens 640 px form. Transport radio **Local command (stdio)** / **HTTPS server**. Display name and server id per schema; stdio fields **Executable** (absolute path), repeatable **Arguments** (one value per row, no shell parsing), environment-variable names with separate masked secret values. HTTP field **Server URL** (HTTPS only). Optional **Paste configuration JSON** textarea is a draft import; validate and map into fields, never connect on paste. Invalid JSON names the parse error without executing anything.

**Review server** calls extensions.validate only. Review dialog title **“Review MCP server”**, visible sections:

- **Command**: exact commandPreview, wrap or horizontally scroll only the code block. For HTTPS show URL rather than fake shell syntax.
- **Network domains**: returned domain list or **“Not declared”**, never “No network access” when unknown.
- **File access and sandbox**: returned scope statement. Explain **“These are the declared scopes. A local server runs as your user; install only servers you trust.”** Never present requested scopes as an OS-enforced guarantee unless runtime proves it.
- **Credentials**: environment names and **Stored in Keychain**, no values. Explain that enabled server receives those credentials. No secrets in code preview, logs or toasts.

Footer **Back**, **Cancel** (safe initial focus), **Install**. Explicit trust checkbox **“I trust this server with the access shown above.”** unchecked; Install disabled until checked. If config changes, invalidate prior review/trust. Install calls extensions.add with reviewed config, then clears secret input on either result. Persisted secret refs cannot be edited by reading them back. Installing is not enabling unreviewed future configuration changes.

Custom server rows show Enabled / Disabled / Connecting / safe error, transport, endpoint/executable preview, **Review configuration**, **Remove**. **“Remove this MCP server?”** confirmation explains removal from Cutroom and deletion of stored Cutroom credential references (only claim key deletion if backend confirms it), not removal of executable or provider revocation. Cancel / Remove server. No install shell commands auto-run to acquire a missing binary.

## 8. OpenAI › Codex sign-in

Keep existing OpenAI API key form. Provider description becomes **“Use an API key, or let Claude consult your signed-in Codex CLI.”** Native fieldset **Connection method**, choices **API key** / **Use my Codex sign-in (ChatGPT)**. Selecting a method reveals controls only; never launches Terminal, disconnects a key or silently enables the extension.

Important distinction from Claude's primary sign-in: **Codex is a read-only tool available through Claude, not a Claude model or an OpenAI model selectable in the assistant model picker.** Place below the fieldset: **“Claude uses Codex for read-only tasks. Connect Claude separately to start the assistant.”** Preserve OpenAI API-key status if present; Codex status is separate, not a falsely connected API-key account.

Terminal inset reuses settings-connections.md's Claude geometry and lifecycle:

| accounts.codex.status | Copy / actions |
|---|---|
| Initial loading | “Checking Codex…”; don't assume not installed |
| available false | **“Codex CLI not found”**, **Check again**; “Install Codex in Terminal, then check again, or use an API key.” No enabled login launcher |
| available true, loggedIn false | **“Not signed in”**, **Open Terminal to sign in**, **Check again** |
| Launch succeeded | **“Finish signing in in Terminal”**; “Cutroom will check for your sign-in for up to 2 minutes.” Indeterminate bar, poll every 3 s, manual Check again and Open Terminal again |
| Logged in, mode chatgpt | **“Signed in with ChatGPT”**, version if returned |
| Logged in, mode api-key | **“Codex signed in with an API key”**, not ChatGPT or a fabricated subscription |
| Logged in, mode null | **“Codex is signed in”**, no inferred mode |
| Timeout | **“Sign-in hasn't been detected yet. Finish in Terminal, then check again.”** Stop polling/bar; allow manual check |

Exact helper **“Sign-in happens in Codex in Terminal. Cutroom never sees your ChatGPT password or tokens.”** Literal command details may show `codex login` and `codex login status`; never tokens, device codes, auth.json contents, email or plan claims not supplied by status. Poll cleanup on unmount/method change/success; status errors do not imply signed out.

Detected but not enabled: **Use this sign-in** explicitly enables the Codex extension (`extensions.setEnabled`, id from extensions.list), not an invented accounts.codex.setMethod. Label pending **Enabling…**. Enabled: **“Codex available to Claude”**, **Check again**, **Disable in Cutroom** (disables extension only). Helper **“Disabling this connection doesn't sign you out of Codex.”** API key, if any, is kept; both summaries can coexist. No Cutroom Sign out action touching CLI credentials. This read-only handoff does not promise Codex file-writing, timeline edits, primary-model routing or usage quotas.

## 9. Projects, creation and Folder media

### Recents

Projects heading **“Projects”**, subtitle **“Open a recent edit or create a project from your footage.”** Header actions **Open project** secondary / **New project** primary. List from project.listRecent, not media.list. Rows ≥80 px: folder icon32, name15 semibold; display path12 secondary (wrap, selectable); format12; last opened12; **Open**28, overflow action **Remove from list**. Current project adds **Open now** badge. Sort by returned last-opened order; don't invent thumbnail frames or durations.

Missing path: warning icon **“Folder not found”**, Open disabled, **Remove from list** available; removal edits recents only, never deletes files. Open failure retains row and shows precise error/Retry; never convert failure to an empty project. Empty list: **“Your edits will appear here.”** + New project / Open project; help **“You can open an existing footage folder and create a project without moving its files.”** Loading/error have distinct placeholders and Retry.

### New project

Single 640 px dialog **“New project”**, not a fake three-step team wizard. Initial focus Name; footer Cancel / **Create project**.

1. **Name**, required; preview folder name after backend sanitization if available, not renderer authority.
2. **Location**, read-only displayPath + **Choose location** (`dialog.pickFolder`, purpose projectParent). Help **“Creates a new folder here. Existing folders won't be overwritten.”** No absolute-path text input. Display path is for humans; invoke passes parentGrant.
3. **Format**, labelled ratio 16:9 / 9:16 / 1:1, resolution and fps. Defaults 16:9, 1920×1080, 30 fps unless project defaults specify otherwise. Portrait default1080×1920; square1080×1080. Explicit fps options from schema, not unsupported free text. Changing ratio visibly updates size before create.
4. **Composition engine**, HyperFrames default / Remotion. Remotion selection requires existing licence acknowledgement flow; if it can't run, show reason, don't pretend licensed/ready.
5. Optional **Footage folder** + **Choose footage**, display selection and Remove. Help **“Copies files into Footage (raw/). Originals stay where they are.”** No Move/Link switch. No folder grant stored in localStorage.

Create disabled until name/location/format valid, with reason beside action. Choosing/cancelling native folder picker preserves other values; cancelled picker is not an error. Create submits grants once, opens Editor on returned session and refreshes recents/current state. Double-click protection: **Creating…**, no repeated submissions. Copy progress uses media.progress when provided; unknown totals stay indeterminate. If creation succeeds but later copy fails, open the created project with actual import error and **Retry import**, never recreate a duplicate on Retry. If backend cannot distinguish partial creation, refetch current state before offering retry. Expired grant: preserve fields, **“Choose this folder again to continue.”** Native picker grants expire in 10 min and are one-use.

### Open a plain folder

Open project and **Browse media folder** use the same native openProject picker and project.open. Existing project opens directly. needsCreate response → 560 px dialog **“Create a project in this folder?”**. Show displayPath and main's looseMediaCount: **“Found N media files in the folder root.”** Never say empty merely because standard folders aren't present.

Body **“Cutroom will add project files and its standard folders here. Existing files stay in place.”** Editable Name (folder-derived default), same Format / Engine fields. Inset summary:

- Added: `.cutroom/`, `timeline.json`, and any missing standard folders.
- Existing files: **Kept in place**.
- Loose media: **Visible in Folder root; not copied automatically**.

Cancel initial focus / **Create project here**. No source-copy promise: createInPlace is different from project.create's optional footage copy. Main validates any existing conflicting files; show error rather than overwrite. Cancel returns to original screen and leaves disk unchanged. Confirm calls createInPlace using returned grantId, then opens Editor and refreshes Projects. Existing current project remains unchanged on cancel/failure.

### Folder root and media actions

Sidebar **Folder media** opens current project's Media tab. No project → same Open flow above. Do not keep a second, ephemeral media-only workspace or let Projects and Folder media disagree about the selected root. Project id and recents come from main.

Section order: **Folder root** (if loose files exist), Footage, References, Assets, Audio, Renders, matching available media sections. Folder root header shows count, lock icon and **“Files stay in this folder. Agents can't change them.”** Actions **Copy into Footage** per card or selection (project.adoptLooseMedia, relative rels only). Copy is deliberate and non-destructive; success focuses imported Footage copy, note **“Copied to Footage. Original kept.”** Originals remain in Folder root. Collision uses returned unique name, never predicts successful overwrite. Failure retains selection and exact item errors.

Media cards offer **Add to timeline** and **Open in editor** for supported media. Add video/image to matching visual track, audio to appropriate music/audio track per backend kind, at current timeline end using timeline.apply. Result switches Editor and selects created clip. Unsupported kinds have disabled action plus visible reason, not dead buttons. Open in editor navigates with source selected; it does not export/run/transcribe by itself. Transcribe, import and export are separate named actions. Empty Media: **“Add footage to start editing.”**, Import files / Import from URL; no project-level “can't run” placeholder once service is wired.

## 10. Home Start and truthful availability

Goal field, microphone, **Project** selector and **Start** sit together, not across a dashboard. Selector lists current + recents by id, name and displayPath; excludes missing recents from selectable options (show disabled with Folder not found). Final choices **New project…** / **Open project…** preserve drafted goal. Current project default selected; otherwise no selection, **“Choose a project”**, never auto-target an arbitrary recent.

Prerequisites are adjacent to Start, not tooltip-only, in this order:

1. No project: **“Choose or create a project to start.”** Start disabled; New project / Open project available.
2. Claude not connected: **Connect Claude** opens Accounts; retain goal and chosen project.
3. Empty goal: **“Describe what you want to make.”** Start disabled.
4. Agent service unavailable before F8: **“Assistant setup isn't available in this build. You can open the editor and edit manually.”** Open editor action available. Remove this only when agent.start/send work.

Start on a recent opens it first, waits for session, then enters Editor › Assistant, starts an edit session and sends the frozen goal/context. Pending label **Starting…**; no duplicate sends. If open fails, keep Home draft. If agent start succeeds but send fails, keep draft in Assistant with Retry; reuse session, do not create a second project or session automatically. On accepted send, Home may clear only the submitted draft; preserve any text subsequently typed. Read-only questions use separate **Ask a question** control and explicit mode, not Start silently selecting ask mode.

Assistant model picker remains Sonnet 5.5 (default), Opus 5.5, Haiku 5.5. Codex appears as a named tool activity, not an extra Claude model. ElevenLabs audio uses the built-in API-key tools by default; hosted MCP is optional, experimental, separately authenticated. In Audio, unknown estimate/balance is **Balance unavailable**, never 0. Paid Generate is only enabled when real service/prerequisites are ready.

Teams, Runs, Backlog and Notes remain honestly labelled **“Not available in this build”** in this round. No fake running cards, quotas, cost totals, team steps or Start run controls. A usable manual Editor / Media / Export remains available even when no AI service is connected.

## 11. Keyboard and acceptance

Existing spec §15 remains authoritative: ⌘O Open project; ⇧⌘N New project; ⌘N Home composer; ⌘, Settings; ⌘K Ask. Native field editing suppresses timeline shortcuts. No new global key bindings. Return submits a valid form only (not textarea); radio arrows never launch a process. Modal Escape closes except where an in-progress destructive action requires an explicit wait/cancel state; trap focus and restore invoking control. Destructive confirmations initial-focus Cancel. Closing a backgroundable import/export dialog doesn't cancel its job.

Implementation checks, in addition to task tests:

- All five settings pages have real loading, content, saved, validation, pending and failure states; changes don't disappear when save fails.
- Cleanup shows main's exact item list/token and needs explicit removal; extension install cannot bypass validation/review/trust; no secrets appear in either preview.
- Codex detection never falsely connects the OpenAI API-key card, launches only on click, stops polling correctly, and leaves existing API-key connection intact.
- Plain footage folder → confirm create-in-place → Folder root media → Projects recent after restart; source files unchanged. New project optional footage explicitly copies.
- Home retains goal through project and account setup, uses the chosen project, and sends only once into Assistant. Manual editing doesn't require an AI connection.
- At 1024×768 and 390×844, fields, paths, safe actions and error text remain reachable; no document overflow. Test both system appearances, visible focus and reduced motion.

References: [settings-workspace.html](mockups/settings-workspace.html), [projects.html](mockups/projects.html), [codex-signin.html](mockups/codex-signin.html). Native controls and links illustrate states; they do not invoke services or authenticate anyone.
