# elftia-computer-use

Standalone computer-use CLI: JSON-stdout desktop perception and input automation for
any shell-capable agent (Elftia TinyElf, Claude Code, Codex). Windows-first through a
**zero-dependency PowerShell facade** (no native modules); macOS/Linux fail honestly
with `ENOTSUPPORTED`.

The CLI is stateless per invocation. It drives the perception-action loop
(screenshot → decide → act → verify) one step at a time; the agent (or human) supplies
the loop. Payload discipline: screenshots and UIA trees always go to **files**; stdout
carries **one JSON object** with paths and metadata only — never base64, never blobs.

## Install

Requirements: Node ≥ 18 on Windows (PowerShell 5.1+, built into Windows 10/11).

```bash
git clone <this-repo> elftia-computer-use
cd elftia-computer-use
npm install        # dev-only dependencies (typescript, vitest, eslint)
npm run build      # tsc + copies the .ps1 backend scripts into dist/
```

Then either put the repo's `dist/cli.js` on your agent's PATH, or:

```bash
npm link           # exposes the "computer-use" bin globally (local machine only)
computer-use --version
```

Sanity-check the machine before first use:

```bash
computer-use doctor     # or: node dist/cli.js doctor
```

## Commands (v0.5 contract)

| Command | Effect | stdout payload (inside `{"ok":true,...}`) |
| --- | --- | --- |
| `apps` | List top-level windows (Z-order) | `apps: [{id, pid, title, appName, bounds}]` |
| `get-state [--app <pid>] [--out <dir>]` | Write `state.json` + `screen.png`; `--app` targets that process's window | `state` path, `screen`, `cursor`, `activeWindow`, `elementsCount`, `elementsTruncated`, `screenshot` |
| `screenshot [--window <id>] [--out <dir>] [--max-edge <px>]` | Write `screen.png`; `--window` crops to live window bounds; `--max-edge` downsamples the longest edge | `path`, `width`, `height`, `window` (window mode only) |
| `click --x <n> --y <n> [--button left\|right\|middle] [--double\|--triple] [--mods ctrl\|shift\|alt]` | Click at screen coordinates (mods combinable: `ctrl+shift`) | `action`, `mode`, `x`, `y`, `button`, `clickCount`, `mods`, `after`? |
| `click --state <state.json> --element <idx>` | Click a prior get-state element, rescaled against the window's live bounds | same + `element`, `rescaledFrom` |
| `type --text <s>` | Paste UTF-8 text (CJK, emoji) into the focused element via clipboard | `action`, `characters`, `after`? |
| `key --combo <combo>` | Press a key combination, e.g. `ctrl+s`, `ctrl+shift+t`, `alt+f4`, bare `enter` | `action`, `combo`, `after`? |
| `scroll --x <n> --y <n> --direction up\|down\|left\|right --amount <n>` | Scroll at the given coordinates | `action`, `x`, `y`, `direction`, `amount`, `after`? |
| `drag --from-x <n> --from-y <n> --to-x <n> --to-y <n>` | Press-move-release drag between two screen points | `action`, `from`, `to`, `after`? |
| `uia-tree [--app <pid>] [--max-depth <n>] [--out <file>]` | Write the UIA tree to a file (depth default 4, node cap 4000) | `file`, `count`, `truncated` |
| `doctor` | Non-destructive self-tests | `os`, `checks[]`, overall `ok` |

Common options:

- `--out <dir|file>` — output location. Default `<cwd>/.computer-use/<timestamp>/`
  (uia-tree's `--out` is a file, defaulting into that directory).
- `--shot` — action commands only (click/type/key/scroll/drag): also capture an
  after-screenshot and return it as `after: {path, width, height}`.
- `--help` / `-h`, `--version` / `-V` — plain text, work on every platform.

`--window` accepts decimal or `0x`-prefixed window ids (as printed by `apps`).
Screen coordinates may be negative (multi-monitor desktops).

## JSON / stdout contract

Every command prints **exactly one JSON object** to stdout and exits `0` on success,
`1` on failure. Success: `{"ok": true, ...payload}`. Failure:

```json
{"ok": false, "error": {"code": "ESTALE", "message": "..."}}
```

Error codes:

| Code | Meaning |
| --- | --- |
| `EUSAGE` | Bad arguments (unknown command/flag, failed validation, unreadable/malformed state file) |
| `ENOTSUPPORTED` | No implementation on this platform (`not yet supported on macos/linux`) |
| `EBACKEND` | PowerShell spawn failure or unparseable backend output |
| `EINPUT` | A native operation rejected the request (SendInput/SetCursorPos failure, unknown window) |
| `ESTALE` | The state file's window no longer matches the desktop — re-run `get-state` |
| `EIO` | Output directory / artifact write failure |

stdout is always UTF-8; the console codepage is handled internally (no mojibake on
CJK window titles or typed text).

## state.json (schema 1)

Written by `get-state` next to `screen.png`:

```json
{
  "schema": 1,
  "createdAt": "2026-08-18T12:00:00.000Z",
  "screen": { "width": 2560, "height": 1440 },
  "cursor": { "x": 512, "y": 384 },
  "activeWindow": { "id": 657916, "pid": 4242, "title": "…", "appName": "…",
                    "bounds": { "x": 0, "y": 0, "width": 1280, "height": 720 } },
  "screenshot": { "path": "…\\screen.png", "width": 1280, "height": 720 },
  "elements": [
    { "index": 0, "role": "button", "name": "OK", "controlType": "Button",
      "bounds": { "x": 10, "y": 20, "width": 80, "height": 24 },
      "center": { "x": 50, "y": 32 } }
  ],
  "elementsTruncated": false
}
```

- `elements` is a bounded (max 200, `elementsTruncated: true` when capped) summary of
  the active window's interactive UIA elements in **screen coordinates** — click by
  pixel or by `--element <idx>`.
- Schema evolution: additive fields only; `schema` bumps on breaking changes.

## Coordinate rules

- **Screenshots report their ACTUAL PNG pixel dimensions** — after `--window` crop
  and `--max-edge` downsampling, never the native screen size. When you plan clicks
  from a screenshot, rescale your pixel picks by `screen.width / screenshot.width`
  per axis.
- **Element addressing self-heals**: `click --state <file> --element <idx>` rescales
  the element's captured center against the window's **live** bounds, so a window
  that moved or resized since capture still lands correctly. If the window is gone
  (or minimized), you get `ESTALE` — recover by running `get-state` again.
- Capture and coordinates share one DPI-aware process (per-monitor-v2 when
  available), so physical pixels and reported coordinates agree on scaled displays.

## Platform support

| OS | Status |
| --- | --- |
| Windows 10/11 (PowerShell 5.1+) | Implemented (all commands) |
| macOS | Not supported — every platform-backed command exits `1` with `ENOTSUPPORTED` |
| Linux | Not supported — same honest failure |

## Safety & known limitations

- **This controls a real machine.** Clicks, keys, drags, and typed text act on
  whatever window is focused. Agents driving this CLI should confirm before
  destructive actions and never auto-accept system dialogs.
- **`type` replaces the clipboard.** It pastes via `Set-Clipboard` + Ctrl+V; the
  user's clipboard content is overwritten (v0.5 accepts this; no restore mode yet).
- **UIPI**: input injected from a non-elevated process is silently discarded by
  elevated windows. `doctor` reports the CLI's elevation level; run both at the same
  level when targeting elevated apps.
- **Latency**: every operation spawns PowerShell (~200–500 ms cold). `doctor`
  reports the measured spawn latency. Fine for the perception-action loop; not for
  high-frequency input.
- **AV/EDR**: some endpoint software flags spawned `powershell.exe`. Scripts ship
  inside the package (never `%TEMP%`), run with `-NoProfile -NonInteractive`, and
  `doctor` surfaces spawn failures as first-class check results.
- **`--text` length**: text is passed as a script argument; extremely long strings
  (approaching the ~32k Windows command-line limit) should be split.
- **Electron/Chromium apps** may expose no UIA elements until OS accessibility is
  active; `uia-tree`/`get-state` then simply return fewer elements (no fake data).
- **Windows-only native details**: SendInput failures propagate as `EINPUT` —
  never a silent fake success.

## Development

```bash
npm run lint     # self-contained flat eslint (no-var, eqeqeq, prefer-const, import order)
npm test         # vitest; full unit suite passes on any OS via the injectable
                 # PlatformBackend seam; real-PowerShell tests are skipIf(!win32)
npm run build    # tsc + copy .ps1 scripts + verify bin shebang
node dist/cli.js doctor   # end-to-end self-test
```

All agent-facing text (help, errors, docs) is English. Zero runtime dependencies;
dev-only tooling lives in `devDependencies`. Not published to npm.
