use crate::{
    err,
    simulation::{self, Scene},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::{
    fs,
    io::{BufRead, BufReader, BufWriter, Write},
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc, LazyLock,
        atomic::{AtomicBool, AtomicU32, Ordering},
    },
    thread::{self, JoinHandle},
    time::Duration,
};
use tempfile::{NamedTempFile, TempDir};

pub const PRESET: &str = include_str!("../plate/Saltos.cinetique");
const STATES: &[u8] = include_bytes!("../plate/saltos.bin");
const WORKER: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/plate-render.exe"));
static ORIGINAL: LazyLock<Scene> =
    LazyLock::new(|| serde_json::from_str(PRESET).expect("Saltos intégré"));
const PX: f64 = 29. / 0.12;
fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-12
}
pub fn original(s: &Scene) -> bool {
    let o = &*ORIGINAL;
    s.nodes.len() == o.nodes.len()
        && s.springs.len() == o.springs.len()
        && close(s.gravity, o.gravity)
        && s.nodes.iter().zip(&o.nodes).all(|(n, r)| {
            n.id == r.id
                && n.kind == r.kind
                && n.parent == r.parent
                && [
                    n.x,
                    n.y,
                    n.mass,
                    n.radius,
                    n.width,
                    n.length,
                    n.angle,
                    n.eccentric,
                    n.speed,
                ]
                .into_iter()
                .zip([
                    r.x,
                    r.y,
                    r.mass,
                    r.radius,
                    r.width,
                    r.length,
                    r.angle,
                    r.eccentric,
                    r.speed,
                ])
                .all(|(a, b)| close(a, b))
        })
        && s.springs.iter().zip(&o.springs).all(|(a, b)| {
            a.a == b.a && a.b == b.b && close(a.stiffness, b.stiffness) && close(a.rest, b.rest)
        })
}
fn sample(frame: usize) -> [f64; 8] {
    let offset = (frame + 120) * 64;
    std::array::from_fn(|j| {
        f64::from_le_bytes(
            STATES[offset + j * 8..offset + j * 8 + 8]
                .try_into()
                .unwrap(),
        )
    })
}
pub fn state(frame: usize) -> Vec<f64> {
    let first = sample(0);
    let v = sample(frame);
    vec![
        (v[0] - first[0]) / PX,
        86. * (v[1] - first[1]) / PX,
        v[2],
        v[3] - (first[3] - ORIGINAL.nodes[5].angle.to_radians()),
        v[4] / PX,
        86. * v[5] / PX,
        v[6],
        v[7],
    ]
}

pub struct Job {
    dir: PathBuf,
    cancel: Arc<AtomicBool>,
    progress: Arc<AtomicU32>,
    total: u32,
    task: Option<JoinHandle<Result<Value, String>>>,
}
impl Job {
    pub fn start(
        scene: Scene,
        target: Option<PathBuf>,
        still: Option<u32>,
    ) -> Result<Self, String> {
        scene.validate()?;
        if scene.nodes.is_empty() {
            return Err("Ajoutez une pièce au plan.".into());
        }
        let total = scene.duration * 60;
        let still = still.map(|v| v.min(total));
        let work = TempDir::new().map_err(err)?;
        let dir = work.path().to_owned();
        let progress = Arc::new(AtomicU32::new(0));
        let p = progress.clone();
        let cancel = Arc::new(AtomicBool::new(false));
        let c = cancel.clone();
        let task = thread::spawn(move || render(work, scene, target, still, &p, &c));
        Ok(Self {
            dir,
            cancel,
            progress,
            total,
            task: Some(task),
        })
    }
    pub fn done(&self) -> bool {
        self.task.as_ref().is_none_or(|t| t.is_finished())
    }
    pub fn poll(&mut self) -> Result<Value, String> {
        if !self.done() {
            return Ok(
                json!({"done":false,"frame":self.progress.load(Ordering::Relaxed),"total":self.total}),
            );
        }
        self.task
            .take()
            .ok_or("Rendu fermé.")?
            .join()
            .map_err(|_| "Échec du rendu.".to_string())?
    }
}
impl Drop for Job {
    fn drop(&mut self) {
        if let Some(t) = self.task.take() {
            self.cancel.store(true, Ordering::Relaxed);
            let _ = fs::write(self.dir.join("cancel"), []);
            let _ = t.join();
        }
    }
}
fn render(
    work: TempDir,
    scene: Scene,
    target: Option<PathBuf>,
    still: Option<u32>,
    progress: &AtomicU32,
    cancel: &AtomicBool,
) -> Result<Value, String> {
    let folder = work.path();
    fs::write(
        folder.join("scene.json"),
        serde_json::to_vec(&scene).map_err(err)?,
    )
    .map_err(err)?;
    if original(&scene) {
        fs::write(folder.join("reference.bin"), STATES).map_err(err)?;
    } else {
        let frames = simulation::simulate(&scene, || cancel.load(Ordering::Relaxed))?;
        let mut poses = BufWriter::new(fs::File::create(folder.join("poses.bin")).map_err(err)?);
        for frame in frames {
            for node in frame {
                for v in &node[..3] {
                    poses.write_all(&v.to_le_bytes()).map_err(err)?
                }
            }
        }
        poses.flush().map_err(err)?;
    }
    if cancel.load(Ordering::Relaxed) {
        return Err("Rendu annulé.".into());
    }
    let exe = folder.join("plate-render.exe");
    fs::write(&exe, WORKER).map_err(err)?;
    let dest_dir = target
        .as_deref()
        .and_then(Path::parent)
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(folder);
    let stage = NamedTempFile::new_in(dest_dir).map_err(err)?;
    let log = folder.join("rendu.log");
    let mut command = Command::new(exe);
    command
        .creation_flags(0x08000000)
        .arg(folder)
        .arg(stage.path());
    if let Some(i) = still {
        command.arg(i.to_string());
    }
    let mut child = command
        .stdout(Stdio::piped())
        .stdin(Stdio::null())
        .stderr(fs::File::create(&log).map_err(err)?)
        .spawn()
        .map_err(err)?;
    for line in BufReader::new(child.stdout.take().unwrap())
        .lines()
        .map_while(Result::ok)
    {
        if let Ok(frame) = line.parse::<u32>() {
            progress.store(frame, Ordering::Relaxed);
        }
    }
    let success = child.wait().map_err(err)?.success();
    if cancel.load(Ordering::Relaxed) {
        return Err("Rendu annulé.".into());
    }
    if !success {
        let log = fs::read_to_string(log).unwrap_or_default();
        return Err(format!(
            "Échec du rendu. {}",
            log.lines()
                .rev()
                .find(|s| !s.is_empty())
                .unwrap_or("Vérifiez FFmpeg.")
        ));
    }
    if let Some(path) = target {
        stage.persist(&path).map_err(err)?;
        Ok(json!({"done":true,"path":path}))
    } else {
        let bytes = fs::read(stage.path()).map_err(err)?;
        Ok(json!({"done":true,"image":STANDARD.encode(bytes)}))
    }
}
pub fn from_cli(input: &std::ffi::OsStr, output: PathBuf) -> Result<(), String> {
    let scene: Scene = if input == "saltos" {
        (*ORIGINAL).clone()
    } else {
        serde_json::from_slice(&fs::read(input).map_err(err)?).map_err(err)?
    };
    let still = match output
        .extension()
        .and_then(|s| s.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => Some(0),
        Some("mp4") => None,
        _ => return Err("Extension PNG ou MP4 requise.".into()),
    };
    let mut job = Job::start(
        scene,
        Some(std::path::absolute(output).map_err(err)?),
        still,
    )?;
    while !job.done() {
        thread::sleep(Duration::from_millis(100));
    }
    job.poll()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editable_saltos_poses_match_the_source_film_in_screen_coordinates() {
        let scene = ORIGINAL.clone();
        let frames = simulation::simulate(&scene, || false).unwrap();
        for (i, pose) in frames.iter().enumerate() {
            let [x, spin, a, b, ..] = sample(i);
            let cx = 548. + x + 86. * spin;
            let cy = 959. - 86.;
            let elbow = [
                cx - 32. * spin.sin() + 179. * a.sin(),
                cy + 32. * spin.cos() + 179. * a.cos(),
            ];
            let tip = [elbow[0] + 167. * b.sin(), elbow[1] + 167. * b.cos()];
            for (node, expected) in [(2, [540. + x, 988.]), (3, [cx, cy]), (4, elbow), (5, tip)] {
                assert!((540. + PX * pose[node][0] - expected[0]).abs() < 1e-9);
                assert!((988. + PX * pose[node][1] - expected[1]).abs() < 1e-9);
            }
        }
    }

    #[test]
    fn a_physics_edit_recomputes_the_motion() {
        let mut scene = ORIGINAL.clone();
        scene.duration = 1;
        let reference = simulation::simulate(&scene, || false).unwrap();
        scene.nodes[4].mass *= 1.5;
        assert!(!original(&scene));
        let edited = simulation::simulate(&scene, || false).unwrap();
        assert!((edited[60][5][0] - reference[60][5][0]).abs() > 1e-4);
    }
}
