#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod runtime;
use runtime::Runtime;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    Manager,
};

#[tauri::command]
async fn api_request(
    state: tauri::State<'_, Runtime>,
    path: String,
    method: String,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if !path.starts_with("/api/")
        || path.contains("..")
        || path.contains('\\')
        || path.contains('#')
    {
        return Err("Caminho inválido".into());
    }
    let verb = match method.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "DELETE" => reqwest::Method::DELETE,
        _ => return Err("Método inválido".into()),
    };
    let request = state
        .client
        .request(verb, format!("http://127.0.0.1:17381{path}"))
        .bearer_auth(&state.admin_token);
    let request = if body.is_null() {
        request
    } else {
        request.json(&body)
    };
    let response = request
        .send()
        .await
        .map_err(|_| "Serviço iniciando. Aguarde alguns segundos.".to_string())?;
    let status = response.status();
    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "Resposta inválida".to_string())?;
    if !status.is_success() {
        return Err(data["error"].as_str().unwrap_or("Falha na operação").into());
    }
    Ok(data)
}
#[tauri::command]
fn runtime_status(state: tauri::State<'_, Runtime>) -> serde_json::Value {
    state.status()
}
#[tauri::command]
fn configure_tunnel(state: tauri::State<'_, Runtime>, token: String) -> Result<(), String> {
    state.configure_tunnel(&token)
}
fn show(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)))
        .invoke_handler(tauri::generate_handler![
            api_request,
            runtime_status,
            configure_tunnel
        ])
        .setup(|app| {
            let runtime = Runtime::start(app.handle())?;
            app.manage(runtime);
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
