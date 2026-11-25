use std::{env, path::PathBuf, process::Command};

fn main() {
    println!("cargo:rerun-if-changed=ui/icon.ico");
    println!("cargo:rerun-if-changed=plate/render.py");
    println!("cargo:rerun-if-changed=plate/ink.py");
    winresource::WindowsResource::new()
        .set_icon("ui/icon.ico")
        .compile()
        .unwrap();

    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let result = Command::new("python")
        .args([
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--onefile",
            "--console",
            "--noupx",
            "--name",
            "plate-render",
            "--log-level",
            "WARN",
        ])
        .args([
            "--exclude-module",
            "scipy",
            "--exclude-module",
            "matplotlib",
            "--exclude-module",
            "tkinter",
            "--exclude-module",
            "IPython",
            "--exclude-module",
            "pytest",
            "--exclude-module",
            "PyQt6",
            "--exclude-module",
            "torch",
        ])
        .arg("--distpath")
        .arg(&out)
        .arg("--workpath")
        .arg(out.join("py-work"))
        .arg("--specpath")
        .arg(&out)
        .arg("plate/render.py")
        .status()
        .expect("Lancer Python avec PyInstaller, NumPy et Pillow");
    assert!(
        result.success(),
        "Échec de la compilation du moteur de dessin"
    );
}
