export const HELP_TEXT = `computer-use — desktop perception and input automation CLI (v0.5)

Usage:
  computer-use <command> [options]

Commands:
  apps                                        List top-level application windows (JSON array)
  get-state [--app <pid>] [--out <dir>]       Write state.json + screen.png into --out; stdout carries the state path + metadata
  screenshot [--window <id>] [--out <dir>] [--max-edge <px>]
                                              Write screen.png; stdout carries {path, width, height, window}
                                              width/height are the PNG's ACTUAL pixel dims (after crop/downsample)
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

Common options:
  --out <dir|file>    Output location (default: <cwd>/.computer-use/<timestamp>/)
  --shot              Action commands only: also capture an after-screenshot ("after" field)
  --help, -h          Show this help
  --version, -V       Print the CLI version

Output discipline:
  Every command prints exactly one JSON object to stdout; exit code 0 = success, 1 = failure.
  Screenshots and UIA trees are always written to files — stdout carries paths and metadata only.
  Failure shape: {"ok": false, "error": {"code": "...", "message": "..."}}
  Error codes: EUSAGE, ENOTSUPPORTED, EBACKEND, EINPUT, ESTALE, EIO.

Platform support: Windows (zero-dependency PowerShell backend).
macOS/Linux: commands fail with ENOTSUPPORTED (honest failure, no fake success).
`
