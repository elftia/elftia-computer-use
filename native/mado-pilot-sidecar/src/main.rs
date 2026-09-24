//! One-request JSON bridge from the Computer Use CLI to MadoPilot.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use mado_pilot::{
    CoordinateSpace, DefaultOcrConfig, DeliveryPlan, Engine, FindRequest, FocusPolicy, Frame,
    FrameRequest, InputDelivery, InputEvent, InputOpenRequest, InputOperationKind, InputRequest,
    InputRequirement, InputSequence, MatchDefaults, MatchOptions, NativeEngineRequest, OcrRegion,
    OcrRequest, OpenRequest, OperationContext, PixelExtent, PixelFormat, Point, PointerButton,
    PointerGeometry, Session, SessionRequest, Status, TargetDescription, TargetKind,
    TemplateEncoding, TemplateId, TemplateSource, TemplateSourceRequest, TemplateTerminalOutcome,
    TemplateWatchRequest,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const MAX_REQUEST_BYTES: u64 = 64 * 1024;
const MAX_TEMPLATE_BYTES: u64 = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS: u64 = 10_000;
const MAX_TIMEOUT_MS: u64 = 120_000;

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    Health,
    ListTargets,
    Capture {
        target: String,
    },
    FindTemplate {
        target: String,
        template: PathBuf,
        #[serde(default = "default_min_score")]
        min_score: f64,
    },
    WaitTemplate {
        target: String,
        template: PathBuf,
        #[serde(default = "default_min_score")]
        min_score: f64,
        #[serde(default = "default_timeout")]
        timeout_ms: u64,
    },
    ReadText {
        target: String,
    },
    Click {
        target: String,
        x: f64,
        y: f64,
        route: Route,
        expected_hash: String,
    },
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Route {
    System,
    WindowMessage,
    ProcessDirected,
}

impl Route {
    fn delivery(self) -> InputDelivery {
        match self {
            Self::System => InputDelivery::System,
            Self::WindowMessage => InputDelivery::WindowMessage,
            Self::ProcessDirected => InputDelivery::ProcessDirected,
        }
    }
}

fn default_min_score() -> f64 {
    0.85
}

fn default_timeout() -> u64 {
    DEFAULT_TIMEOUT_MS
}

struct Options {
    output_root: PathBuf,
    model_root: Option<PathBuf>,
    runtime_path: Option<PathBuf>,
}

fn main() {
    let result = (|| -> Result<Value, String> {
        let options = parse_options()?;
        let mut input = String::new();
        io::stdin()
            .take(MAX_REQUEST_BYTES + 1)
            .read_to_string(&mut input)
            .map_err(|_| "failed to read request".to_owned())?;
        if input.len() as u64 > MAX_REQUEST_BYTES {
            return Err("request exceeds 64 KiB".to_owned());
        }
        let request: Request = serde_json::from_str(input.trim())
            .map_err(|_| "invalid request JSON or command fields".to_owned())?;
        execute(request, &options)
    })();
    let response = match result {
        Ok(data) if data.get("input_complete").and_then(Value::as_bool) == Some(false) => json!({
            "ok": false,
            "error": {
                "code": "EINPUT",
                "message": "MadoPilot input did not complete",
                "receipt": data["receipt"],
                "before": data["before"],
            }
        }),
        Ok(data) => json!({ "ok": true, "data": data }),
        Err(message) => json!({ "ok": false, "error": { "code": "EMADO", "message": message } }),
    };
    println!("{response}");
    if response["ok"] == false {
        std::process::exit(1);
    }
}

fn parse_options() -> Result<Options, String> {
    let mut output_root = None;
    let mut model_root = None;
    let mut runtime_path = None;
    let mut args = std::env::args_os().skip(1);
    while let Some(flag) = args.next() {
        let value = args.next().ok_or("each option requires a path")?;
        match flag.to_str() {
            Some("--output-root") if output_root.is_none() => {
                output_root = Some(PathBuf::from(value))
            }
            Some("--model-root") if model_root.is_none() => model_root = Some(PathBuf::from(value)),
            Some("--runtime-path") if runtime_path.is_none() => {
                runtime_path = Some(PathBuf::from(value))
            }
            _ => return Err("unknown or duplicate sidecar option".to_owned()),
        }
    }
    let output_root = output_root.ok_or("--output-root is required")?;
    if !output_root.is_absolute() {
        return Err("--output-root must be absolute".to_owned());
    }
    if model_root.is_some() != runtime_path.is_some() {
        return Err("--model-root and --runtime-path must be supplied together".to_owned());
    }
    if model_root.as_ref().is_some_and(|path| !path.is_absolute())
        || runtime_path
            .as_ref()
            .is_some_and(|path| !path.is_absolute())
    {
        return Err("OCR paths must be absolute".to_owned());
    }
    let runtime_path = runtime_path
        .map(|path| {
            fs::canonicalize(path).map_err(|_| "ONNX runtime file is unavailable".to_owned())
        })
        .transpose()?;
    Ok(Options {
        output_root,
        model_root,
        runtime_path,
    })
}

fn operation(timeout_ms: u64) -> Result<OperationContext, String> {
    if !(1..=MAX_TIMEOUT_MS).contains(&timeout_ms) {
        return Err("timeout_ms must be between 1 and 120000".to_owned());
    }
    OperationContext::new()
        .with_timeout(Duration::from_millis(timeout_ms))
        .map_err(|error| error.to_string())
}

#[cfg(windows)]
fn engine(options: &Options, op: &OperationContext) -> Result<Engine, String> {
    if let (Some(model_root), Some(runtime_path)) = (&options.model_root, &options.runtime_path) {
        let config = DefaultOcrConfig::new(model_root, runtime_path);
        mado_pilot::windows_engine_with_default_ocr(NativeEngineRequest::new(), &config, op)
            .map_err(|error| error.to_string())
    } else {
        mado_pilot::windows_engine(NativeEngineRequest::new()).map_err(|error| error.to_string())
    }
}

#[cfg(target_os = "macos")]
fn engine(options: &Options, op: &OperationContext) -> Result<Engine, String> {
    if let (Some(model_root), Some(runtime_path)) = (&options.model_root, &options.runtime_path) {
        let config = DefaultOcrConfig::new(model_root, runtime_path);
        mado_pilot::macos_engine_with_default_ocr(NativeEngineRequest::new(), &config, op)
            .map_err(|error| error.to_string())
    } else {
        mado_pilot::macos_engine(NativeEngineRequest::new()).map_err(|error| error.to_string())
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
fn engine(_options: &Options, _op: &OperationContext) -> Result<Engine, String> {
    Err("MadoPilot native capture supports Windows and macOS only".to_owned())
}

fn target(
    engine: &Engine,
    selected: &str,
    op: &OperationContext,
) -> Result<TargetDescription, String> {
    let matches: Vec<_> = engine
        .discover(op)
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|item| target_key(item).as_deref() == Some(selected))
        .collect();
    match matches.as_slice() {
        [item] => Ok(item.clone()),
        [] => Err("target is unavailable; list targets again".to_owned()),
        _ => Err("target selector is ambiguous; use another window".to_owned()),
    }
}

/// The Engine-owned TargetId cannot survive a one-request subprocess. This
/// selector binds the advertised title to native process provenance, then
/// discover() must return exactly one matching window in the new Engine.
fn target_key(target: &TargetDescription) -> Option<String> {
    let identity = target.process_identity()?;
    if target.capability().kind() != Some(TargetKind::Window) {
        return None;
    }
    let mut digest = Sha256::new();
    let pid = identity.process_id().get().to_le_bytes();
    let lifetime = identity.lifetime().to_le_bytes();
    let executable_path = identity.executable_path().to_string_lossy();
    for field in [
        target.name().as_bytes(),
        &pid,
        &lifetime,
        executable_path.as_bytes(),
    ] {
        digest.update((field.len() as u64).to_le_bytes());
        digest.update(field);
    }
    Some(digest_hex(&digest.finalize()))
}

fn with_session<T>(
    engine: &Engine,
    selected: &str,
    input_route: Option<InputDelivery>,
    op: &OperationContext,
    work: impl FnOnce(&Session) -> Result<T, String>,
) -> Result<T, String> {
    let target = target(engine, selected, op)?;
    let mut request = SessionRequest::new().capturing(OpenRequest::new());
    if let Some(route) = input_route {
        request = request.requesting_input(
            InputOpenRequest::new()
                .with_requirement(InputRequirement::Required)
                .requiring(InputOperationKind::Pointer, route),
        );
    }
    let session = engine
        .open_session(target.id(), &request, op)
        .map_err(|error| error.to_string())?;
    let result = work(&session);
    let closed = session
        .close(&operation(DEFAULT_TIMEOUT_MS)?)
        .map_err(|error| error.to_string());
    match (result, closed) {
        (Err(error), _) => Err(error),
        (Ok(_), Err(error)) => Err(format!("session close failed: {error}")),
        (Ok(value), Ok(())) => Ok(value),
    }
}

fn execute(request: Request, options: &Options) -> Result<Value, String> {
    let op = operation(DEFAULT_TIMEOUT_MS)?;
    let engine = engine(options, &op)?;
    match request {
        Request::Health => {
            let targets = engine.discover(&op).map_err(|error| error.to_string())?;
            Ok(json!({
                "protocol": 1,
                "backend": "mado-pilot",
                "version": "0.4.0",
                "discoverable_targets": targets.len(),
                "ocr_ready": engine.ocr_backend().is_some(),
            }))
        }
        Request::ListTargets => {
            let targets = engine.discover(&op).map_err(|error| error.to_string())?;
            let mut counts = HashMap::new();
            for key in targets.iter().filter_map(target_key) {
                *counts.entry(key).or_insert(0_usize) += 1;
            }
            Ok(json!(
                targets
                    .iter()
                    .filter_map(|item| target_key(item).filter(|key| counts[key] == 1).map(
                        |key| json!({
                            "id": key,
                            "name": item.name(),
                            "kind": format!("{:?}", item.capability().kind()),
                            "width": item.extent().width(),
                            "height": item.extent().height(),
                        })
                    ))
                    .collect::<Vec<_>>()
            ))
        }
        Request::Capture { target } => with_session(&engine, &target, None, &op, |session| {
            let frame = session
                .acquire_frame(&FrameRequest::latest(), &op)
                .map_err(|error| error.to_string())?;
            let image_hash = frame_hash(&frame, &op)?;
            let image = save_png(&frame, options)?;
            Ok(json!({ "image": image, "image_hash": image_hash, "frame": stamp(&frame) }))
        }),
        Request::FindTemplate {
            target,
            template,
            min_score,
        } => {
            let prepared = prepare_template(&engine, &template, min_score, &op)?;
            with_session(&engine, &target, None, &op, |session| {
                let frame = session
                    .acquire_frame(&FrameRequest::latest(), &op)
                    .map_err(|error| error.to_string())?;
                let found = session
                    .find_template(
                        &FindRequest::exact(
                            &frame,
                            &prepared,
                            MatchOptions::from_defaults(prepared.defaults()),
                        ),
                        &op,
                    )
                    .map_err(|error| error.to_string())?;
                Ok(json!({
                    "frame": stamp(&frame),
                    "matches": found.result().matches().iter().map(|item| json!({
                        "score": item.score(),
                        "left": item.bounds().left(), "top": item.bounds().top(),
                        "right": item.bounds().right(), "bottom": item.bounds().bottom(),
                    })).collect::<Vec<_>>(),
                }))
            })
        }
        Request::WaitTemplate {
            target,
            template,
            min_score,
            timeout_ms,
        } => {
            let wait_op = operation(timeout_ms)?;
            let prepared = prepare_template(&engine, &template, min_score, &wait_op)?;
            with_session(&engine, &target, None, &wait_op, |session| {
                let query = session
                    .start_template_watch(TemplateWatchRequest::new(
                        prepared.clone(),
                        MatchOptions::from_defaults(prepared.defaults()),
                        wait_op.clone(),
                    ))
                    .map_err(|error| error.to_string())?;
                // The query and caller wait have separate deadlines. Let the
                // query commit its terminal result before the caller expires.
                let caller_wait = operation(timeout_ms.saturating_add(2_000).min(MAX_TIMEOUT_MS))?;
                let outcome = query
                    .wait(&caller_wait)
                    .map_err(|error| error.to_string())?;
                match outcome.as_ref() {
                    TemplateTerminalOutcome::Matched(result) => Ok(json!({
                        "matched": true,
                        "frame": stamp(result.frame()),
                        "matches": result.result().matches().iter().map(|item| json!({
                            "score": item.score(),
                            "left": item.bounds().left(), "top": item.bounds().top(),
                            "right": item.bounds().right(), "bottom": item.bounds().bottom(),
                        })).collect::<Vec<_>>(),
                    })),
                    TemplateTerminalOutcome::DeadlineExceeded => {
                        Ok(json!({ "matched": false, "reason": "deadline" }))
                    }
                    other => Err(format!("template query ended: {other:?}")),
                }
            })
        }
        Request::ReadText { target } => {
            if options.model_root.is_none() {
                return Err("OCR requires --model-root and --runtime-path".to_owned());
            }
            let descriptor = engine.ocr_backend().ok_or("OCR backend is unavailable")?;
            with_session(&engine, &target, None, &op, |session| {
                let frame = session
                    .acquire_frame(&FrameRequest::latest(), &op)
                    .map_err(|error| error.to_string())?;
                let result = session
                    .recognize(OcrRequest::new(
                        &frame,
                        descriptor.backend_identity(),
                        descriptor.model_identity(),
                        OcrRegion::FullFrame,
                        CoordinateSpace::CapturePixels,
                        &op,
                    ))
                    .map_err(|error| error.to_string())?;
                Ok(json!({
                    "frame": stamp(&frame),
                    "regions": result.regions().iter().map(|region| json!({
                        "text": region.text(), "confidence": region.confidence().get(),
                        "points": region.geometry().points().iter().map(|point| json!({
                            "x": point.x(), "y": point.y(),
                        })).collect::<Vec<_>>(),
                    })).collect::<Vec<_>>(),
                }))
            })
        }
        Request::Click {
            target,
            x,
            y,
            route,
            expected_hash,
        } => {
            if expected_hash.len() != 64
                || !expected_hash
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
            {
                return Err("expected_hash must be a lowercase SHA-256 hex digest".to_owned());
            }
            let delivery = route.delivery();
            with_session(&engine, &target, Some(delivery), &op, |session| {
                let before = session
                    .acquire_frame(&FrameRequest::latest(), &op)
                    .map_err(|error| error.to_string())?;
                let source_stamp = before.stamp();
                if frame_hash(&before, &op)? != expected_hash {
                    return Err("target image changed; capture again before clicking".to_owned());
                }
                let position = Point::new(CoordinateSpace::CapturePixels, x, y)
                    .map_err(|error| error.to_string())?;
                let sequence = InputSequence::new(vec![
                    InputEvent::PointerMove(position),
                    InputEvent::PointerPress(PointerButton::Primary),
                    InputEvent::PointerRelease(PointerButton::Primary),
                ])
                .map_err(|error| error.to_string())?;
                let focus = if matches!(route, Route::System) {
                    FocusPolicy::ActivateIfRequired
                } else {
                    FocusPolicy::Preserve
                };
                let receipt = session
                    .send_input(
                        &InputRequest::new(
                            session.target(),
                            sequence,
                            DeliveryPlan::require(delivery),
                        )
                        .with_focus(focus)
                        .with_pointer_geometry(
                            PointerGeometry::require_unchanged_since(source_stamp),
                        ),
                        &op,
                    )
                    .map_err(|error| error.to_string())?;
                let receipt_data = json!({
                    "outcome": receipt.outcome().as_str(),
                    "submitted": receipt.submitted(),
                    "fault": receipt.fault().map(|fault| format!("{fault:?}")),
                    "attempts": receipt.attempts().iter().map(|attempt| json!({
                        "route": format!("{:?}", attempt.route()),
                        "outcome": attempt.outcome().as_str(),
                        "submitted": attempt.submitted(),
                        "fault": attempt.fault().map(|fault| format!("{fault:?}")),
                    })).collect::<Vec<_>>(),
                    "partial_native_effect": receipt.partial_native_effect(),
                    "cleanup": receipt.cleanup().as_str(),
                    "cleanup_released": receipt.cleanup_released(),
                    "cleanup_owed": receipt.cleanup_owed(),
                });
                // A partial sequence can leave a pressed button. Preserve the
                // receipt but do not wait for another frame or imply success.
                if receipt.outcome() != mado_pilot::SequenceOutcome::Complete {
                    return Ok(json!({
                        "input_complete": false,
                        "receipt": receipt_data,
                        "before": stamp(&before),
                    }));
                }
                let after_op = operation(1_500)?;
                match session.acquire_frame(&FrameRequest::newer_than(source_stamp), &after_op) {
                    Ok(after) => {
                        let image = save_png(&after, options)?;
                        Ok(json!({
                            "input_complete": true,
                            "receipt": receipt_data,
                            "before": stamp(&before), "after": stamp(&after), "image": image,
                        }))
                    }
                    Err(error) if error.status() == Status::DeadlineExceeded => Ok(json!({
                        "input_complete": true,
                        "receipt": receipt_data,
                        "before": stamp(&before),
                        "after_available": false,
                    })),
                    Err(error) => Err(error.to_string()),
                }
            })
        }
    }
}

fn prepare_template(
    engine: &Engine,
    path: &Path,
    min_score: f64,
    op: &OperationContext,
) -> Result<mado_pilot::PreparedTemplate, String> {
    let meta = fs::metadata(path).map_err(|_| "template file is unavailable")?;
    if !meta.is_file() || meta.len() > MAX_TEMPLATE_BYTES {
        return Err("template must be a regular PNG no larger than 16 MiB".to_owned());
    }
    let bytes = fs::read(path).map_err(|_| "template file could not be read")?;
    if TemplateEncoding::identify(&bytes) != Some(TemplateEncoding::Png) || bytes.len() < 24 {
        return Err("template must be a PNG".to_owned());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().expect("PNG header width"));
    let height = u32::from_be_bytes(bytes[20..24].try_into().expect("PNG header height"));
    let extent = PixelExtent::new(width, height);
    let defaults = MatchDefaults::new(min_score, 16).map_err(|error| error.to_string())?;
    let source = TemplateSource::new(TemplateSourceRequest {
        id: TemplateId::new("caller-template").map_err(|error| error.to_string())?,
        encoding: TemplateEncoding::Png,
        extent,
        space: CoordinateSpace::CapturePixels,
        defaults,
        content: Arc::from(bytes),
    })
    .map_err(|error| error.to_string())?;
    engine
        .prepare_template(&source, op)
        .map_err(|error| error.to_string())
}

fn stamp(frame: &Frame) -> Value {
    let stamp = frame.stamp();
    json!({
        "stream": format!("{:?}", stamp.stream()),
        "epoch": stamp.epoch().value(),
        "sequence": stamp.sequence().value(),
        "geometry": stamp.geometry().value(),
    })
}

fn frame_hash(frame: &Frame, op: &OperationContext) -> Result<String, String> {
    let mapping = frame
        .map(PixelFormat::Rgba8, op)
        .map_err(|error| error.to_string())?;
    let descriptor = mapping.descriptor();
    let width = descriptor.extent().width();
    let height = descriptor.extent().height();
    let row_bytes = usize::try_from(width)
        .map_err(|_| "image width overflow")?
        .checked_mul(4)
        .ok_or("image row overflow")?;
    let mut digest = Sha256::new();
    digest.update(width.to_le_bytes());
    digest.update(height.to_le_bytes());
    for row in 0..usize::try_from(height).map_err(|_| "image height overflow")? {
        let start = row
            .checked_mul(descriptor.stride())
            .ok_or("image stride overflow")?;
        let end = start.checked_add(row_bytes).ok_or("image row overflow")?;
        digest.update(
            mapping
                .bytes()
                .get(start..end)
                .ok_or("mapped image is short")?,
        );
    }
    Ok(digest_hex(&digest.finalize()))
}

fn digest_hex(digest: &[u8]) -> String {
    let mut result = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(&mut result, "{byte:02x}").expect("writing to String cannot fail");
    }
    result
}

fn save_png(frame: &Frame, options: &Options) -> Result<Value, String> {
    let op = operation(DEFAULT_TIMEOUT_MS)?;
    let mapping = frame
        .map(PixelFormat::Rgba8, &op)
        .map_err(|error| error.to_string())?;
    let descriptor = mapping.descriptor();
    let width = descriptor.extent().width();
    let height = descriptor.extent().height();
    let row_bytes = usize::try_from(width)
        .map_err(|_| "image width overflow")?
        .checked_mul(4)
        .ok_or("image row overflow")?;
    let rows = usize::try_from(height).map_err(|_| "image height overflow")?;
    let capacity = row_bytes.checked_mul(rows).ok_or("image length overflow")?;
    let mut packed = Vec::with_capacity(capacity);
    for row in 0..rows {
        let start = row
            .checked_mul(descriptor.stride())
            .ok_or("image stride overflow")?;
        let end = start.checked_add(row_bytes).ok_or("image row overflow")?;
        packed.extend_from_slice(
            mapping
                .bytes()
                .get(start..end)
                .ok_or("mapped image is short")?,
        );
    }
    fs::create_dir_all(&options.output_root)
        .map_err(|_| "output directory could not be created")?;
    let filename = format!(
        "mado-{}-{}-{}.png",
        std::process::id(),
        frame.stamp().epoch().value(),
        frame.stamp().sequence().value()
    );
    let path = options.output_root.join(filename);
    let file = create_new(&path)?;
    let mut encoder = png::Encoder::new(file, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().map_err(|_| "PNG encoder failed")?;
    writer
        .write_image_data(&packed)
        .map_err(|_| "PNG write failed")?;
    Ok(json!({ "path": path, "width": width, "height": height }))
}

fn create_new(path: &Path) -> Result<File, String> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| "output file could not be created".to_owned())
}
