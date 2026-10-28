/// Desktop-only commands, granted to the main window (see capabilities/) also when it shows the
/// web app served by the backend.
const COMMANDS: &[&str] = &[
    "runtime_status",
    "configure_tunnel",
    "autostart_status",
    "set_autostart",
    "check_update",
    "install_update",
];

fn main() {
    let manifest = tauri_build::AppManifest::new().commands(COMMANDS);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest)).expect("tauri build");
}
