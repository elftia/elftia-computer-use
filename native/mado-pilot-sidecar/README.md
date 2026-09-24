# Elftia MadoPilot sidecar

This optional native executable serves one JSON request on stdin and prints one
JSON response on stdout. The Computer Use CLI starts a fresh process per command
with `--output-root <absolute directory>` and optional OCR paths. Captured pixels
are saved as PNG files; stdout carries only paths and metadata. The CLI enforces
a wall-clock deadline and terminates a timed-out process.

The currently supported commands are `health`, `list_targets`, `capture`,
`find_template`, `wait_template`, `read_text`, and `click`. Each request uses a
new Engine; `health` constructs it and probes discovery. Target actions require
the opaque selector returned by `list_targets`. The selector hashes the
window title and verified process ID, lifetime and executable path. A later
command rediscovers windows and requires exactly one match; a closed process,
reused PID, renamed window or ambiguous match is refused. A window recreated by
the same live process with the same title cannot be distinguished across
processes, so `click` requires the image hash returned by a preceding capture.
It captures a new frame and refuses a pixel mismatch before submitting input,
then returns a submission receipt plus a strictly newer frame when the window
publishes one. If no new frame arrives within 1.5 seconds, the receipt is
returned with `after_available:false`; callers should capture again to verify
the application effect. `wait_template` accepts the first matching frame,
including a static window.
Partial native input is an error and must never be automatically retried.
`read_text` requires the two controlled OCR model files and ONNX Runtime 1.29.0.

Build with Rust 1.97.1 and MadoPilot's native prerequisites. The dependency is
pinned to commit `e6b3f55914fb942afe4049630e659b2793ea1220`. OpenCV is
required for matching. OCR also needs a compatible ONNX Runtime library and
MadoPilot's model directory. The CLI discovers an executable in its sibling
`native/` directory, with OpenCV, ONNX Runtime and `models/` beside it. Override
the executable and OCR paths with `ELFTIA_MADO_PILOT_SIDECAR`,
`ELFTIA_MADO_PILOT_MODEL_ROOT` and `ELFTIA_MADO_PILOT_RUNTIME_PATH` when needed.
The CLI downloads no models.

```text
cargo build --release --locked
```

The plugin's local `install:mado-native` script stages a native bundle in its
skill tree; `npm run build` then includes it in the installable `dist/` tree.
Binary assets are ignored by Git and must be staged on each packaging machine.
