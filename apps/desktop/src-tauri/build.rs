use std::env;

fn main() {
    println!("cargo:rerun-if-env-changed=TAURI_PERSONAL_INSTALL");
    println!("cargo:rustc-check-cfg=cfg(tauri_personal_install)");
    if env::var("TAURI_PERSONAL_INSTALL").as_deref() == Ok("1") {
        println!("cargo:rustc-cfg=tauri_personal_install");
    }
    tauri_build::build();
}
