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
  key --combo <combo>                         Press a key combination, e.g. ctrl+s, ctrl+shift+t, alt+f4
  scroll --x <n> --y <n> --direction up|down|left|right --amount <n>
                                              Scroll at the given coordinates
  drag --from-x <n> --from-y <n> --to-x <n> --to-y <n>
                                              Press-move-release drag between two screen points
  uia-tree [--app <pid>] [--max-depth <n>] [--out <file>]
                                              Write the UIA tree to a file; stdout carries path + node count
  doctor                                      Run non-destructive self-tests (PowerShell, UTF-8, screenshot, input)
  mado --action <action> [options]            Optional MadoPilot native window capture, template matching, OCR, input

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

Platform support: Windows (zero-dependency PowerShell core; optional native MadoPilot).
macOS/Linux: commands fail with ENOTSUPPORTED (honest failure, no fake success).
`
