#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod runtime;
mod updates;
use runtime::{Runtime, APP_URL};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

const AUTOSTART_ARG: &str = "--autostart";

#[tauri::command]
fn runtime_status(state: tauri::State<'_, Runtime>) -> serde_json::Value {
    state.status()
}
#[tauri::command]
fn configure_tunnel(state: tauri::State<'_, Runtime>, token: String) -> Result<(), String> {
    state.configure_tunnel(&token)
}
#[tauri::command]
fn autostart_status(app: tauri::AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}
#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    let result = if enabled { manager.enable() } else { manager.disable() };
    result.map_err(|_| "Não foi possível atualizar o início automático.".to_string())
}
fn show(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updates::Updates::default())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_ARG]),
        ))
        .invoke_handler(tauri::generate_handler![
            runtime_status,
            configure_tunnel,
            autostart_status,
            set_autostart,
            updates::check_update,
            updates::install_update
        ])
        .setup(|app| {
            let runtime = Runtime::start(app.handle())?;
            app.manage(runtime);
            // One app for everyone: the window shows the web app served by the backend, exactly
            // what browsers on the network open (in development, the Vite server proxying the API).
            let url = if cfg!(debug_assertions) {
                WebviewUrl::App("index.html".into())
            } else {
                WebviewUrl::External(APP_URL.parse()?)
            };
            WebviewWindowBuilder::new(app, "main", url)
                .title("WA MCP · Cappyfy")
                .inner_size(1240.0, 820.0)
                .min_inner_size(800.0, 600.0)
                .visible(false)
                .build()?;
            let marker = app.path().app_local_data_dir()?.join("autostart-initialized");
            if !marker.exists() {
                let _ = app.autolaunch().enable();
                let _ = std::fs::write(&marker, "");
            }
            if !std::env::args().any(|arg| arg == AUTOSTART_ARG) {
                show(app.handle());
            }
            let open = MenuItem::with_id(app, "open", "Abrir WA MCP", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("WA MCP · Cappyfy")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show(app),
                    "quit" => {
                        app.state::<Runtime>().stop();
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("Falha ao iniciar WA MCP")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<Runtime>().stop();
            }
        });
}
