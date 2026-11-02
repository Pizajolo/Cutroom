# Accounts and automatic tool setup

Implementation supplement for the 2026-11-01 accounts/tools repair. This document supersedes older account-auth and tool-install wording in `spec.md`; editor, timeline, assistant and export designs are unchanged. Reference screens use fictional statuses, not successful live connections.

**2026-11-02 continuation:** [round5.md](round5.md) adds the five remaining Settings sections, OpenAI's Codex Terminal sign-in method, Projects/New project/create-in-place/Folder root and Home Start. Its availability and Audio/hosted-MCP wording supersedes the future-only copy here as those services become implemented; account secrecy and automatic tool-install rules still apply.

## Direction and layout

Keep the editing desk identity, not a separate onboarding wizard. Core palette: graphite `#191c20`, slate `#23272d`, primary ink `#e8edf2`, secondary ink `#b4bec9`, steel-blue action `#9cc8ef`, muted mint success `#a4d3b4`. Amber indicates waiting/network trouble; rose indicates rejected credentials or failed verification. System sans for all settings; tabular numerals for byte counts/times, monospace only for commands. Existing Lucide outline icons, 16 px, work offline.

Review of the initial approach: identical dashboard tiles would hide the different connection methods and waste editor space. Instead use one wider Claude card with nested method controls, then compact stacked provider cards. Tools remain a scan-friendly table, not download cards. No branding colours, gradients, quota rings, setup score or celebratory animation. The distinctive element is the direct, visible handoff to the user's own Terminal rather than a misleading embedded login.

```text
176 global nav | 200 settings nav | 24 inset  Accounts / Tools
               |                 |            intro / security note
               |                 |            Claude (two methods)
               |                 |            OpenAI
               |                 |            ElevenLabs
```

- Content left aligned; account stack max 880 px, tools max 1080 px. Empty right space is intentional, not a fourth panel.
- Settings content scrolls vertically; left navigation remains available. Cards never scroll internally. Card padding 20 px, gap 16 px, radius 8 px, subtle 1 px border, no shadow. Card headings 15 px semibold; descriptions 12–13 px, maximum 70 characters per line.
- Keep existing app sidebar collapse below 1280 px. At viewport ≤700 px settings navigation becomes wrapping section buttons, content padding 16 px; provider headers/actions wrap and password field fills one row. At ≤440 px the global rail may remain 56 px; no horizontal page scrolling. The tools table may scroll inside its labelled region, not the whole document.
- Connected state is compact, but its provider heading does not move. Show only last-four preview supplied by main. Never show key length or infer usage from a connection.

## Accounts

Page intro: **“Connect the services you use in Cutroom.”** Security note: **“API keys are stored in your macOS Keychain. Cutroom only shows the last four characters.”** No claim that account connection enables an unbuilt generation or chat feature.

Each provider is a named `section` with heading, status, contextual detail, last check and actions. Provider order: Claude, OpenAI, ElevenLabs. `anthropic` is an implementation identifier; the visible provider is **Claude**. Use a text+icon badge, not a coloured dot alone.

| Contract status | Label | Tone / icon | Behaviour |
|---|---|---|---|
| `not_connected` | Not connected | neutral / circle | Show connection form; last checked “Not checked yet” if null |
| `connected` | Connected | success / circle-check | Show saved method, preview when applicable, detail, Verify and Disconnect |
| `invalid` | Key rejected | danger / circle-alert | Keep stored preview; show replacement form, Verify and Disconnect |
| `unreachable` | Can't reach service | warning / cloud-off | Keep connection method/preview; “Your saved connection hasn't been removed.” Verify and Disconnect; replacement is optional |

“Checking…” is a transient action state, not an invented persisted status. Keep the last-known badge visible while checking. `checkedAt` is rendered as a localized date/time (e.g. “Last checked today at 14:42”), full date in a `time` title. Null never becomes the current time. `detail` wraps and must not be discarded because it contains plan or permission information. ElevenLabs missing `user_read` permission is still Connected and displays the exact main-process detail; unknown balance is not zero.

### API key form (all providers)

Persistent label **“Claude API key”**, **“OpenAI API key”**, or **“ElevenLabs API key”**. Password input + primary **Connect** (or **Replace key** if replacing rejected/valid saved credentials). Input min width 0, flexible up to 460 px; action 28 px high, fixed min width 88 px. Placeholder “Paste your API key”; never use a key-like fake value. `type=password`, `autocomplete=off`, `spellcheck=false`, `autocapitalize=none`. No reveal button, clipboard read, key preview calculation, global store or persistence in renderer. User paste is allowed. Form Enter submits; no global keyboard shortcuts while typing.

1. On submit capture the key only for the IPC request and clear the controlled field immediately, including failure. This is an explicit exception to components.md's generic preserve-input-on-error rule.
2. Pending button **“Connecting…”**; disable duplicate submission and provider method switching, leave other provider cards usable. No fake Connected badge before IPC succeeds.
3. Accepted: display returned preview/detail, replace form with saved-connection row, polite announcement **“OpenAI connected.”** Focus the provider's Verify button after the form disappears.
4. Rejected: inline Notice **“OpenAI rejected this key.”** (safe IPC message); field is empty, labelled invalid and described by error. Focus empty field so it can be replaced. Existing saved connection stays unchanged on a failed replacement.
5. Network/Keychain failure: show the safe unavailable message inline, not a redacted request payload. Do not mark an unvalidated key saved, and do not fabricate persisted account state.

“Create an API key at platform.claude.com / platform.openai.com / elevenlabs.io” is supporting copy. Only make a clickable external link if an approved external-browser API exists; renderer `window.open` and navigation are denied by the security contract. Plain named domain text is acceptable until then. Never embed provider login or key-creation sites.

### Claude methods

Use native radio buttons in a `fieldset`, legend **“Connection method”**. First/default for a disconnected account: **“API key from Claude Console”**, secondary **“Recommended”**. Second: **“Use my Claude Code sign-in”**. When connected, select its actual saved method; changing the radio only reveals a candidate setup and never disconnects or switches the active credential. Keep the card's current connection summary visible until the new method is successfully committed. Clarify **“Current connection stays active until you connect another method.”** when a different candidate is selected.

- API key method reveals the key form and Claude Console domain copy. Do not describe it as a claude.ai subscription key.
- Sign-in method reveals a neutral inset panel. Helper text, exactly: **“Sign-in happens in Claude Code in Terminal. Cutroom never sees your Claude password or tokens.”** No “Log in with Claude” brand button, token field, OAuth code field or embedded browser.
- `available=false`: **“Claude Code not found”**, **Check again**, and **“Use an API key, or install Claude Code and check again.”** Do not offer a Terminal action that cannot run.
- Available/logged out: **“Not signed in”**, primary **Open Terminal to sign in**, secondary **Check again**. User click alone launches Terminal. Do not launch on entering Settings or selecting a radio.
- After launch: **“Finish signing in in Terminal”**, text **“Cutroom will check for your sign-in for up to 2 minutes.”** Neutral indeterminate 4 px activity bar, no percentage. Poll every 3 s up to 2 min. **Check again** remains available (disable only during an in-flight check); **Open Terminal again** is secondary and deliberate. Terminal opening is not a successful connection.
- Timeout: stop polling and bar. **“Sign-in hasn't been detected yet. Finish in Terminal, then check again.”** Keep manual Check again. Do not call it Key rejected.
- Available/logged in: success icon **“Signed in as <email>”**; fall back to **“Claude Code is signed in”** if absent. Display CLI version as secondary metadata when available; never fabricate organization, email or subscription. Primary **Use this sign-in** commits `accounts.claude.setMethod`. Detection alone does not switch methods.
- Successful commit: card shows Connected, **“Claude Code sign-in”** and returned detail, no key preview. Verify checks the CLI sign-in, not Anthropic API-key access. Disconnect confirmation explains **“This removes the connection from Cutroom. It won't sign you out of Claude Code.”**
- On unmount/method change/commit, stop polling. Failed status checks show safe error and permit retry; do not infer sign-out from a network or IPC error.

### Disconnect

Existing confirmation Dialog, 440 px: **“Disconnect OpenAI?”** Body **“Cutroom will remove this API key from your macOS Keychain. You can reconnect later.”** Buttons **Cancel** (initial focus), **Disconnect** (danger). Claude sign-in uses the alternate body above. While pending, **Disconnecting…**, no repeated actions. Failure retains current card state, shows Notice; success returns to Not connected and focuses the first connection control (API key input, or selected method radio for Claude). Never promise provider-side revocation; keys can be revoked at the provider separately.

## Tools and models

Intro, exactly: **“Cutroom downloads these tools automatically and verifies each one by checksum before use.”** Name the section **“Video and transcription tools”** rather than implying all binaries were bundled. No manual first-launch install wizard, success toast per tool, or setup-blocking modal.

Table columns: Tool / Version / Source / Verification / Status / Actions. Minimum table width 760 px. Tool names semibold, data 12 px. Verification is **Pinned checksum**, **Publisher checksum**, or **Not verified yet** for null (never a success shield). Source maps Bundled / Downloaded / Updated. If a not-yet-installed item has only the contract's nominal source, qualify as **“Downloaded (when installed)”** rather than falsely reporting a completed download; no source inference from path. Paths need not be visible. Fixed status area min 180 px and actions min 96 px; cells top aligned with wrapping errors/hints. Standard rows min 52 px; active/error rows grow naturally.

| Install/status state | Display | Actions |
|---|---|---|
| `queued` | Queued, neutral clock | None required by contract; no fake progress percent |
| `downloading` known total | Downloading N%, 4 px bar, “31.2 / 58.0 MB” | Cancel |
| `downloading` unknown total | Downloading, indeterminate bar, “31.2 MB downloaded” | Cancel |
| `verifying` | Verifying checksum, indeterminate | No Download/Retry; no implication file can already run |
| `installing` | Installing, indeterminate | No duplicate action |
| `failed` | Install failed, danger icon + safe wrapping error | Retry (`tools.install`) |
| `ok` with null install | OK, success circle-check | yt-dlp update actions only |
| `missing` with null install, downloadable | Not installed, neutral icon | Install / Retry if prior failure known |
| `checksum_mismatch` | Checksum mismatch, danger shield, “Can't be used until repaired.” | Retry; never Run anyway |
| `missing` with build hint | Build required, warning icon, exact supplied hint | No download button |

`install` phase takes precedence over underlying missing/checksum status. Never display Missing in red beneath a normal queued auto-download. After Cancel, wait for service event then display actual state; do not invent a `cancelled` enum. An operation error belongs to its tool, or the page Notice with the tool named; not another row. Retry is deliberate, no auto-loop.

- Downloaded bytes are not installation completion. Clamp visual byte ratio 0–100; only status `ok`/installed declares completion. Null total omits percentage and `aria-valuenow`; don't divide by zero.
- Progress semantics: `role=progressbar`, unique accessible name (e.g. “ffmpeg download”), min 0/max 100 and `aria-valuenow` for determinate; `aria-valuetext` includes phase and byte text. Phase label outside bar. Announce phase changes/coarse milestones only; button outside updating region to avoid moving focus. CSS supports native `progress` too.
- yt-dlp **Check for updates** → **Checking…** → **Up to date** or **Update to <version>**. The update uses the same progress/retry pattern, keeps current executable until new verified version is ready, and must not imply the current OK tool is unusable while updating. Daily background check is backend policy, not a weekly UI promise. No update affordance for non-updatable tools.
- whisper-cli is a build prerequisite, not a broken network download. Show exact hint as readable text/code, including cmake and Xcode Command Line Tools. Model availability and CLI availability are independent; an installed model does not imply transcription is ready.

### Whisper models

Section copy **“The default model downloads after the tools. Larger models use more storage.”** Rows are 64 px minimum: model / decimal size / state+progress / action. Shipped sizes rounded from actual bytes: base **148 MB**, small **488 MB**, medium **1.53 GB**, large-v3-turbo **1.62 GB**. No claimed speed/quality ranking without product evidence.

- Map installed → **Installed**, missing → **Not downloaded**, mismatch → **Checksum mismatch**, and active install states as above. Selected default adds neutral **Default** tag; not another green status.
- Missing: Download. Downloading: Cancel. Installed: Delete. Failed/mismatch: Retry. Unknown status/loading never shows an enabled Download until list fetch succeeds.
- Default transcription model select lists only installed models. No installed models: disabled select showing **“Waiting for a model”**, note **“Choose a default after a model finishes downloading.”** If saved default is still downloading and a different model is installed, show explicit current-default note rather than silently replacing it.
- Deleting: **“Delete small model?”**, **“This frees 488 MB of local storage. You can download it again.”** Cancel initial focus, Delete model destructive. For current default add **“This is your default model. Transcription will need an installed model.”** Do not invent an automatic replacement; reflect returned list/settings. Don't auto-redownload merely because it was deliberately deleted.
- Keep the Remotion licence section unchanged; this repair must not imply licence setup is complete.

## Sidebar, Home and Audio

- Sidebar non-connected Claude: **Connect Claude** opens Settings → Accounts. Connected: **“Claude connected”**, secondary **“API key”** / **“Claude Code sign-in”**. Unreachable: **“Claude: can't reach service”**; invalid: **“Claude: key rejected”**. These link to Accounts without implying usage availability.
- While tools or default model are queued/downloading/verifying/installing: named link **“Downloading tools…”**; include percentage only where meaningful. Aggregate byte progress is available only if all active download totals are known: sum received / sum total of active downloads, not mean row percentages. Queued/verifying/unknown-total phases show text/bar without percentage. Do not include build-only whisper-cli or optional undownloaded models in the busy condition. At failure show **“Tool setup needs attention”** linking to Tools; don't spin forever. Collapsed rail uses a named 28 px download/status icon and tooltip instead of hidden text-only action.
- Home Claude plan: actual connection method/detail or Not connected. API-key connection does not imply subscription-plan access. ElevenLabs credits: actual returned detail or Not connected. Today/This week remain Unavailable.
- Audio dock: connected ElevenLabs → **“ElevenLabs connected. Audio generation arrives in a later update.”** Otherwise **Connect ElevenLabs** opens Accounts. No enabled Generate control in this task.

## Shared style contract

`src/renderer/styles/app.css` supplies additive classes; no new stylesheet import required:

- `.accounts-settings` → `.accounts-list` → `.account-card`; `.account-card-header`, `.account-provider`, `.account-description`, `.account-meta`, `.account-saved`, `.account-actions`.
- `.connection-status` with `.is-connected` / `.is-invalid` / `.is-unreachable` / `.is-not-connected`; icon and real status text remain children.
- `.account-methods` fieldset → `.account-method` native radio label; `.account-method-body` for selected content. `.method-recommended` supporting tag; `.account-login-panel` neutral Terminal inset.
- `.account-key-form` contains `.account-key-field` (label/input) + `.button`; note/error goes below form, not squeezed between field/action. `.account-security-note`, `.settings-text-link`, `.button.danger`.
- `.install-status` phase, `.install-progress` bar with child `span` whose inline width is the clamped percent; `data-indeterminate="true"` for unknown/verification, no fabricated width. `.install-meta`, `.install-error`, `.tool-hint`, `.tool-actions`. Native `progress.install-progress` also supported.
- Add `.tools-table-live` to existing `.tools-table`; `.model-list-live` to `.model-list`. Each model row uses `.model-name`, `.model-size`, `.model-state`, `.model-actions` for the four columns. `.default-model-tag` is supporting metadata.
- `.sidebar-connection` and `.sidebar-download` support wrapping/status link text.

Existing focus/disabled/control tokens apply. Additive geometry tokens: `--settings-accounts-max-width:880px`, `--settings-tools-max-width:1080px`, `--account-card-padding:20px`, `--account-card-gap:16px`, `--account-method-gap:12px`, `--install-progress-height:4px`, `--install-status-min-width:180px`, `--model-row-min-height:64px`. No new semantic colours.

## Keyboard, errors and acceptance

No new global shortcuts. ⌘, opens Settings; Tab/Shift-Tab navigate, native radio arrow keys change candidate method, Space selects radio, Enter submits form/action, Escape closes confirmation. Radios must not auto-open Terminal. Modal focus restoration follows components.md; input fields suppress editor shortcuts.

List initial loading: “Checking connections…” / “Checking tools…” with polite status, not three fake Not connected/Missing records. Subscribe before initial fetch; a later event must win. List fetch failure gives Notice + Retry, not empty successful cards. Account/tool failures never include credentials or raw request data. Connection pending, download progress and unavailable copy cannot be communicated through colour alone. Focus ring remains 2 px with 2 px offset; errors wrap; reduced motion stops indeterminate movement but leaves phase text visible.

Frontend acceptance: three actual provider cards; immediate input clearing on either result; last-four-only previews; external Terminal handoff followed by explicit Use this sign-in; connected state never inferred from launcher success; live download/verify/failure progress; default-model selector only installed models; no placeholder availability claims outside unchanged Remotion/future-feature copy. Backend acceptance, real credentials and actual binary downloads are separate developer/QA checks.
