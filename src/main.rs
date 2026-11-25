#![windows_subsystem = "windows"]
mod flex;
mod plate;
mod simulation;
use base64::{Engine, engine::general_purpose::STANDARD};
use rfd::FileDialog;
use serde::Deserialize;
use serde_json::{Value, json};
use simulation::Scene;
use std::{
    borrow::Cow,
    fs,
    io::Write,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    thread,
};
use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    window::{Icon, WindowBuilder},
};
use tempfile::NamedTempFile;
use wry::{WebContext, WebViewBuilder, http::Response};

#[derive(Deserialize)]
struct Request {
    id: u64,
    op: String,
    #[serde(default)]
    data: Value,
}
enum Message {
    Request(Request),
    Reply(u64, Result<Value, String>),
}
type ResultValue = Result<Value, String>;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn asset(path: &str) -> Option<(&'static str, &'static [u8])> {
    Some(match path {
        "/" | "/index.html" => (
            "text/html; charset=utf-8",
            include_bytes!("../ui/index.html"),
        ),
        "/cantilever.js" => ("text/javascript", include_bytes!("../ui/cantilever.js")),
        "/flex-editor.js" => ("text/javascript", include_bytes!("../ui/flex-editor.js")),
        "/flex.css" => ("text/css", include_bytes!("../ui/flex.css")),
        "/style.css" => ("text/css", include_bytes!("../ui/style.css")),
        "/analysis.js" => ("text/javascript", include_bytes!("../ui/analysis.js")),
        "/app.js" => ("text/javascript", include_bytes!("../ui/app.js")),
        "/drawing.js" => ("text/javascript", include_bytes!("../ui/drawing.js")),
        "/scenes.js" => ("text/javascript", include_bytes!("../ui/scenes.js")),
        _ => return None,
    })
}
fn decode_scene(data: Value) -> Result<Scene, String> {
    let scene: Scene = serde_json::from_value(data).map_err(err)?;
    scene.validate()?;
    Ok(scene)
}
fn atomic_save(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut tmp = NamedTempFile::new_in(path.parent().unwrap()).map_err(err)?;
    tmp.write_all(bytes).map_err(err)?;
    tmp.as_file().sync_all().map_err(err)?;
    tmp.persist(path).map_err(err)?;
    Ok(())
}
struct Video {
    child: Child,
    temp: Option<NamedTempFile>,
    output: PathBuf,
}
impl Drop for Video {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
impl Video {
    fn start(
        output: PathBuf,
        landscape: Option<u32>,
        audio: Option<&Path>,
    ) -> Result<Self, String> {
        let temp = NamedTempFile::new_in(output.parent().unwrap()).map_err(err)?;
        let mut cmd = Command::new("ffmpeg");
        cmd.creation_flags(0x08000000);
        cmd.args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "image2pipe",
            "-framerate",
        ]);
        cmd.args([
            "60",
            "-c:v",
            if landscape.is_some() { "png" } else { "mjpeg" },
        ]);
        cmd.args(["-i", "pipe:0"]);
        if let Some(path) = audio {
            cmd.arg("-i")
                .arg(path)
                .args(["-map", "0:v:0", "-map", "1:a:0"]);
            let is_aac = Command::new("ffprobe")
                .creation_flags(0x08000000)
                .args([
                    "-v",
                    "error",
                    "-select_streams",
                    "a:0",
                    "-show_entries",
                    "stream=codec_name",
                    "-of",
                    "csv=p=0",
                ])
                .arg(path)
                .output()
                .is_ok_and(|output| {
                    output.status.success()
                        && String::from_utf8_lossy(&output.stdout).trim() == "aac"
                });
            if is_aac {
                cmd.args(["-c:a", "copy"]);
            } else {
                cmd.args(["-af", "apad", "-c:a", "aac", "-b:a", "192k"]);
            }
        } else {
            cmd.arg("-an");
        }
        if let Some(n) = landscape {
            cmd.args(["-t", &format!("{:.9}", n as f64 / 30.)]);
        }
        let child=cmd.args(["-c:v","libx264","-crf",if landscape.is_some(){"15"}else{"18"},"-preset","veryfast",
                "-pix_fmt","yuv420p","-movflags","+faststart","-f","mp4"])
            .arg(temp.path()).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null())
            .spawn().map_err(|e|format!("Impossible de lancer FFmpeg. Vérifiez son installation et le PATH de Windows. {e}"))?;
        Ok(Self {
            child,
            temp: Some(temp),
            output,
        })
    }
    fn finish(mut self) -> ResultValue {
        drop(self.child.stdin.take());
        if !self.child.wait().map_err(err)?.success() {
            return Err("FFmpeg a interrompu l’encodage.".into());
        }
        self.temp
            .take()
            .unwrap()
            .persist(&self.output)
            .map_err(err)?;
        Ok(json!(self.output))
    }
}
fn file_name(title: &str) -> String {
    let clean: String = title
        .chars()
        .filter(|c| !c.is_control() && !r#"<>:"/\|?*"#.contains(*c))
        .take(64)
        .collect();
    let clean = clean.trim_matches([' ', '.']);
    if clean.is_empty() {
        "Schéma".into()
    } else {
        clean.into()
    }
}
struct Files {
    batch: Option<(Value, PathBuf)>,
    audio: Option<PathBuf>,
    plate: Option<plate::Job>,
    project: Option<PathBuf>,
    video: Option<Video>,
}
impl Files {
    fn handle(&mut self, op: &str, data: Value, window: &tao::window::Window) -> ResultValue {
        let dialog = || FileDialog::new().set_parent(window);
        match op {
            "flexSolve" => {
                let mut doc = flex::Drawing::decode(data)?;
                doc.solve()?;
                Ok(json!(doc))
            }
            "flexSession" => Ok(
                json!({"preset":serde_json::from_str::<Value>(flex::PRESET).map_err(err)?,"batch":self.batch.as_ref().map(|v|&v.0),"audio":self.audio.is_some()}),
            ),
            "flexExit" if self.batch.is_some() => {
                std::process::exit(if data == true { 0 } else { 1 })
            }
            "flexAudio" => {
                if data == false {
                    self.audio = None;
                } else if let Some(p) = dialog()
                    .add_filter(
                        "Audio ou vidéo",
                        &["mp4", "m4a", "mp3", "wav", "aac", "flac", "mov", "mkv"],
                    )
                    .pick_file()
                {
                    self.audio = Some(p);
                }
                Ok(json!(self.audio.is_some()))
            }
            "flexVideo" => {
                let doc = flex::Drawing::decode(data)?;
                let output = if let Some((_, p)) = &self.batch {
                    p.clone()
                } else {
                    let Some(p) = dialog()
                        .add_filter("Film MP4", &["mp4"])
                        .set_file_name(format!("{}.mp4", file_name(&doc.name)))
                        .save_file()
                    else {
                        return Ok(Value::Null);
                    };
                    p
                };
                self.video = Some(Video::start(
                    output.clone(),
                    Some(doc.count),
                    self.audio.as_deref(),
                )?);
                Ok(json!(output))
            }
            "saltosPreset" => Ok(serde_json::from_str(plate::PRESET).map_err(err)?),
            "plateStart" | "platePreview" => {
                if self.plate.is_some() {
                    return Err("Un rendu est déjà en cours.".into());
                }
                let scene = decode_scene(data["scene"].clone())?;
                let still = (op == "platePreview")
                    .then(|| data["frame"].as_u64().unwrap_or(0).min(u32::MAX as u64) as u32);
                let path = if still.is_some() {
                    None
                } else {
                    let Some(p) = dialog()
                        .add_filter("Vidéo MP4", &["mp4"])
                        .set_file_name(format!("{}.mp4", file_name(&scene.name)))
                        .save_file()
                    else {
                        return Ok(Value::Null);
                    };
                    Some(p)
                };
                self.plate = Some(plate::Job::start(scene, path, still)?);
                Ok(json!(true))
            }
            "platePoll" => {
                let job = self.plate.as_mut().ok_or("Aucun rendu.")?;
                let result = job.poll();
                if result.as_ref().map_or(true, |v| v["done"] == true) {
                    self.plate.take();
                }
                result
            }
            "plateCancel" => {
                self.plate.take();
                Ok(Value::Null)
            }
            "detach" => {
                self.project = None;
                self.audio = None;
                Ok(Value::Null)
            }
            "open" => {
                let Some(path) = dialog()
                    .add_filter("Projet Cynetic", &["cynetic", "cinetique"])
                    .pick_file()
                else {
                    return Ok(Value::Null);
                };
                if fs::metadata(&path).map_err(err)?.len() > 4_000_000 {
                    return Err("Fichier trop volumineux.".into());
                }
                let value: Value =
                    serde_json::from_slice(&fs::read(&path).map_err(err)?).map_err(err)?;
                let document = if value["kind"] == "cantilever" {
                    json!(flex::Drawing::decode(value)?)
                } else {
                    json!(decode_scene(value)?)
                };
                self.project = Some(path);
                self.audio = None;
                Ok(document)
            }
            "save" | "saveAs" => {
                let (document, stem, ext) = if data["kind"] == "cantilever" {
                    let d = flex::Drawing::decode(data)?;
                    (json!(d), d.name, "cynetic")
                } else {
                    let s = decode_scene(data)?;
                    (json!(s), s.name, "cinetique")
                };
                let path = if op == "save" {
                    self.project.clone()
                } else {
                    None
                };
                let Some(path) = path.or_else(|| {
                    dialog()
                        .add_filter("Projet Cynetic", &[ext])
                        .set_file_name(format!("{}.{}", file_name(&stem), ext))
                        .save_file()
                }) else {
                    return Ok(Value::Null);
                };
                atomic_save(&path, &serde_json::to_vec_pretty(&document).map_err(err)?)?;
                self.project = Some(path.clone());
                Ok(json!(path))
            }
            "png" | "videoStart" => {
                let ext = if op == "png" { "png" } else { "mp4" };
                let stem = file_name(data["name"].as_str().unwrap_or("Schéma"));
                let Some(path) = dialog()
                    .add_filter(ext, &[ext])
                    .set_file_name(format!("{stem}.{ext}"))
                    .save_file()
                else {
                    return Ok(Value::Null);
                };
                if op == "png" {
                    atomic_save(
                        &path,
                        &STANDARD
                            .decode(data["image"].as_str().unwrap_or(""))
                            .map_err(err)?,
                    )?;
                } else {
                    self.video = Some(Video::start(path.clone(), None, None)?);
                }
                Ok(json!(path))
            }
            "videoFrame" => {
                let video = self.video.as_mut().ok_or("Export vidéo fermé.")?;
                let bytes = STANDARD
                    .decode(data.as_str().ok_or("Image absente.")?)
                    .map_err(err)?;
                video
                    .child
                    .stdin
                    .as_mut()
                    .ok_or("Encodeur fermé.")?
                    .write_all(&bytes)
                    .map_err(err)?;
                Ok(Value::Null)
            }
            "videoEnd" => self.video.take().ok_or("Export vidéo fermé.")?.finish(),
            "videoCancel" => {
                self.video.take();
                Ok(Value::Null)
            }
            _ => Err("Commande inconnue.".into()),
        }
    }
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_some_and(|arg| arg == "--render-plate") {
        if args.len() != 4 {
            return Err("Usage : --render-plate <saltos|projet> <sortie.mp4|png>".into());
        }
        return plate::from_cli(&args[2], PathBuf::from(&args[3])).map_err(Into::into);
    }
    let mut batch = None;
    let mut audio = None;
    if args.get(1).is_some_and(|a| a == "--render-flex") {
        if !(4..=5).contains(&args.len()) {
            return Err("Usage: --render-flex <project.cynetic> <output.mp4> [audio]".into());
        }
        let doc = flex::Drawing::decode(serde_json::from_slice(&fs::read(&args[2])?)?)?;
        let output = std::path::absolute(&args[3])?;
        if !output
            .extension()
            .is_some_and(|v| v.eq_ignore_ascii_case("mp4"))
        {
            return Err("Extension MP4 requise".into());
        }
        if let Some(path) = args.get(4) {
            audio = Some(fs::canonicalize(path)?);
        }
        batch = Some((json!(doc), output));
    }
    let events = EventLoopBuilder::<Message>::with_user_event().build();
    let window = WindowBuilder::new()
        .with_visible(batch.is_none())
        .with_title("Cynetic")
        .with_decorations(false)
        .with_window_icon(Some(Icon::from_rgba(
            include_bytes!("../ui/icon.rgba").to_vec(),
            64,
            64,
        )?))
        .with_inner_size(LogicalSize::new(1440., 900.))
        .with_min_inner_size(LogicalSize::new(840., 600.))
        .build(&events)?;
    let proxy = events.create_proxy();
    let replies = proxy.clone();
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let mut context = WebContext::new(Some(base.join("Cynetic").join(if batch.is_some() {
        "RenderWebView"
    } else {
        "WebView"
    })));
    let view=WebViewBuilder::new_with_web_context(&mut context)
        .with_custom_protocol("atelier".into(),|_,request|{
            let entry=asset(request.uri().path());
            let (mime,bytes)=entry.unwrap_or(("text/plain",b"404"));
            Response::builder().status(if entry.is_some(){200}else{404}).header("Content-Type",mime)
                .header("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'")
                .body(Cow::Borrowed(bytes)).unwrap()
        }).with_url("atelier://localhost/")
        .with_navigation_handler(|url|["http://atelier.localhost/","atelier://localhost/"].contains(&url.as_str()))
        .with_new_window_req_handler(|_,_|wry::NewWindowResponse::Deny)
        .with_ipc_handler(move|r|{if let Ok(req)=serde_json::from_str(r.body()){let _=proxy.send_event(Message::Request(req));}})
        .build(&window)?;
    let mut files = Files {
        batch,
        audio,
        plate: None,
        project: None,
        video: None,
    };
    let generation = Arc::new(AtomicU64::new(0));
    events.run(move |event, _, control| {
        *control = ControlFlow::Wait;
        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                generation.fetch_add(1, Ordering::Relaxed);
                files.video.take();
                files.plate.take();
                *control = ControlFlow::Exit;
            }
            Event::UserEvent(Message::Request(r)) => {
                if r.op == "close" {
                    generation.fetch_add(1, Ordering::Relaxed);
                    files.video.take();
                    files.plate.take();
                    *control = ControlFlow::Exit;
                } else if r.op == "simulate" {
                    let revision = generation.fetch_add(1, Ordering::Relaxed) + 1;
                    let token = generation.clone();
                    let back = replies.clone();
                    thread::spawn(move || {
                        let result = decode_scene(r.data)
                            .and_then(|s| {
                                simulation::simulate(&s, || {
                                    token.load(Ordering::Relaxed) != revision
                                })
                            })
                            .map(|frames| json!(frames));
                        let _ = back.send_event(Message::Reply(r.id, result));
                    });
                } else {
                    if r.op == "invalidate" {
                        generation.fetch_add(1, Ordering::Relaxed);
                    }
                    let result = match r.op.as_str() {
                        "invalidate" => Ok(Value::Null),
                        "minimize" => {
                            window.set_minimized(true);
                            Ok(Value::Null)
                        }
                        "maximize" => {
                            window.set_maximized(!window.is_maximized());
                            Ok(Value::Null)
                        }
                        "dragWindow" => window.drag_window().map(|_| Value::Null).map_err(err),
                        _ => files.handle(&r.op, r.data, &window),
                    };
                    let _ = replies.send_event(Message::Reply(r.id, result));
                }
            }
            Event::UserEvent(Message::Reply(id, result)) => {
                let (ok, v) = match result {
                    Ok(v) => (true, v),
                    Err(e) => (false, json!(e)),
                };
                let _ = view.evaluate_script(&format!("window.nativeReply({id},{ok},{v})"));
            }
            _ => {}
        }
    })
}
