export const HELP_TEXT = `computer-use — desktop perception and input automation CLI (v0.5)

Usage:
  computer-use <command> [options]

Commands:
  apps                                        List top-level application windows (JSON array)
  get-state [--app <pid>] [--out <dir>]       Write state.json + screen.png into --out; stdout carries the state path + metadata
  screenshot [--window <id>] [--region <x1,y1,x2,y2>] [--out <dir>] [--max-edge <px>]
                                              Write screen.png; stdout carries {path, width, height, window}
                                              width/height are the PNG's ACTUAL pixel dims (after crop/downsample)
                                              --region is screen-absolute and excludes --window
  crop --in <png> --region <x1,y1,x2,y2> [--out <dir>]
                                              Crop an EXISTING image file (zoom for reading fine text;
                                              never re-captures the screen). Region is in the SOURCE
                                              image's own pixel frame; stdout carries {path, width,
                                              height, source, region}
  click --x <n> --y <n> [--button left|right|middle] [--double|--triple] [--mods ctrl|shift|alt]
                                              Click at screen coordinates (--mods combinable: ctrl+shift)
  click --state <state.json> --element <idx>  Click a prior get-state element; coordinates are rescaled
                                              against the window's live bounds; fails ESTALE if the window is gone
  type --text <s>                             Type UTF-8 text (CJK, emoji) via clipboard paste.
                                              NOTE: replaces the current clipboard content
  key --combo <combo> [--hold-ms <1..60000>]  Press a key combination, e.g. ctrl+s, ctrl+shift+t, alt+f4
                                             --hold-ms presses and HOLDS the key that many ms before
                                             release (hold input: in-game walking, continuous scroll)
  scroll --x <n> --y <n> --direction up|down|left|right --amount <n>
                                              Scroll at the given coordinates
  drag --from-x <n> --from-y <n> --to-x <n> --to-y <n>
                                              Press-move-release drag between two screen points
  uia-tree [--app <pid>] [--max-depth <n>] [--out <file>]
                                              Write the UIA tree to a file; stdout carries path + node count
  doctor                                      Run non-destructive self-tests (PowerShell, UTF-8, screenshot, input)
  mado --action <action> [options]            Optional MadoPilot native window capture, template matching, OCR, input
  cua --action <tool> [--args <json>] [--session <label>]
                                              One-shot Cua Driver SDK tool call (in-process, no daemon).
                                              --action health  checks SDK + native runtime
                                              --action list-tools  dumps the tool schema list
                                              --args is the tool's JSON object (snake_case keys); a session
                                              label is always attached (default "elftia") because snapshots,
                                              element_tokens and window captures bind to the session
  cua-serve [--host 127.0.0.1] [--port 0]     Long-lived Cua Driver server: ONE shared driver instance for
                                              multi-step tasks so snapshot ids / element_tokens stay valid.
                                              Prints {url, token, pid} once, then serves until POST /shutdown:
                                                GET  /health           bearer token required
                                                POST /call             {"action": "<tool>", "args": {...}}
                                                POST /shutdown         ends the server cleanly

Common options:
  --out <dir|file>    Output location (default: <cwd>/.computer-use/<timestamp>/)
  --shot              Action commands only: also capture an after-screenshot ("after" field)
  --help, -h          Show this help
  --version, -V       Print the CLI version

MadoPilot actions (Windows native bundle beside CLI, or ELFTIA_MADO_PILOT_SIDECAR=<absolute path>):
  mado --action health|list-targets
  mado --action capture|read-text --target <id> [--out <dir>]
  mado --action find-template|wait-template --target <id> --template <png>
       [--min-score <0..1>] [--timeout-ms <1..120000>] [--out <dir>]
  mado --action click --target <id> --x <capture-pixel> --y <capture-pixel>
       --route system|window-message|process-directed --expected-hash <capture image_hash> [--out <dir>]
  The id comes from list-targets. A new native process verifies the window on
  each invocation. Click is one primary-button click and requires a matching capture hash.
  OCR uses bundled models/runtime, or both ELFTIA_MADO_PILOT_MODEL_ROOT and
  ELFTIA_MADO_PILOT_RUNTIME_PATH (absolute paths).

Output discipline:
  Every command prints exactly one JSON object to stdout; exit code 0 = success, 1 = failure.
  Screenshots and UIA trees are always written to files — stdout carries paths and metadata only.
  Failure shape: {"ok": false, "error": {"code": "...", "message": "..."}}
  Error codes: EUSAGE, ENOTSUPPORTED, EBACKEND, EINPUT, ESTALE, EIO.

Foreground visibility: every action that drives the REAL mouse/keyboard
  (core click/type/key/scroll/drag, mado --route system, cua delivery_mode
  "foreground") swaps the arrow cursor to arrow+hourglass and fires a tray
  toast while it runs. Opt out with ELFTIA_CU_FOREGROUND_NOTICE=0.

Platform support: Windows (zero-dependency PowerShell core; optional native MadoPilot; Cua Driver SDK).
macOS/Linux: core commands fail with ENOTSUPPORTED (honest failure, no fake success); the Cua SDK
ships native packages for all three platforms.
`
