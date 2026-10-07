use crate::runtime::Runtime;
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::Duration;
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

struct PreparedUpdate {
    update: Update,
    bytes: Vec<u8>,
}
#[derive(Default)]
pub struct Updates {
    checking: AtomicBool,
    prepared: Mutex<Option<PreparedUpdate>>,
}
#[derive(Clone, Serialize)]
pub struct UpdateInfo {
    version: String,
}
struct Checking<'a>(&'a AtomicBool);
impl Drop for Checking<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[tauri::command]
pub async fn check_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, Updates>,
) -> Result<Option<UpdateInfo>, String> {
    if state.checking.swap(true, Ordering::AcqRel) {
        return Err("Verificação já em andamento.".into());
    }
    let _checking = Checking(&state.checking);
    {
        let prepared = state.prepared.lock().map_err(|_| "Falha no atualizador")?;
        if let Some(pending) = prepared.as_ref() {
            return Ok(Some(UpdateInfo {
                version: pending.update.version.clone(),
            }));
        }
    }
    let handle = app.clone();
    let updater = app
        .updater_builder()
        .timeout(Duration::from_secs(180))
        .on_before_exit(move || {
            handle.state::<Runtime>().stop();
        })
        .build()
        .map_err(|_| "Não foi possível iniciar o atualizador.")?;
    let update = updater
        .check()
        .await
        .map_err(|_| "Não foi possível consultar atualizações. Tentaremos novamente mais tarde.")?;
    let Some(update) = update else {
        return Ok(None);
    };
    let _ = app.emit("update-downloading", &update.version);
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|_| "Falha ao baixar ou validar a assinatura da atualização. A versão atual foi mantida.")?;
    let info = UpdateInfo {
        version: update.version.clone(),
    };
    *state.prepared.lock().map_err(|_| "Falha no atualizador")? = Some(PreparedUpdate { update, bytes });
    Ok(Some(info))
}

#[tauri::command]
pub async fn install_update(state: tauri::State<'_, Updates>) -> Result<(), String> {
    let prepared = state
        .prepared
        .lock()
        .map_err(|_| "Falha no atualizador")?
        .take()
        .ok_or("Verifique e baixe a atualização primeiro.")?;
    tauri::async_runtime::spawn_blocking(move || prepared.update.install(&prepared.bytes))
        .await
        .map_err(|_| "Não foi possível iniciar a instalação.")?
        .map_err(|_| "Falha na instalação. Verifique novamente para tentar outra vez.".into())
}
