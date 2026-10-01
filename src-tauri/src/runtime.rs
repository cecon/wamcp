#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    fs,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::Manager;
use uuid::Uuid;

pub struct Runtime {
    pub admin_token: String,
    pub client: reqwest::Client,
    dir: PathBuf,
    resources: PathBuf,
    backend: Mutex<Option<Child>>,
    tunnel: Mutex<Option<Child>>,
}
fn hidden(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
}
impl Runtime {
    pub fn start(app: &tauri::AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let dir = app.path().app_local_data_dir()?;
        fs::create_dir_all(&dir)?;
        let token_path = dir.join("admin.token");
        if !token_path.exists() {
            fs::write(
                &token_path,
                format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple()),
            )?;
        }
        let admin_token = fs::read_to_string(&token_path)?.trim().to_string();
        let resources = if cfg!(debug_assertions) {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("runtime")
        } else {
            app.path().resource_dir()?.join("runtime")
        };
        let child = hidden(
            Command::new(resources.join("node.exe"))
                .arg(resources.join("server/index.mjs"))
                .env("WAMCP_DATA_DIR", &dir)
                .env("WAMCP_ADMIN_TOKEN", &admin_token),
        )
        .spawn()?;
        let state = Self {
            admin_token,
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()?,
            dir,
            resources,
            backend: Mutex::new(Some(child)),
            tunnel: Mutex::new(None),
        };
        if state.dir.join("tunnel.token").exists() {
            let _ = state.start_tunnel();
        }
        Ok(state)
    }
    fn start_tunnel(&self) -> Result<(), String> {
        let mut guard = self.tunnel.lock().map_err(|_| "Falha no estado do túnel")?;
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        let child = hidden(
            Command::new(self.resources.join("cloudflared.exe"))
                .args(["tunnel", "--no-autoupdate", "run", "--token-file"])
                .arg(self.dir.join("tunnel.token")),
        )
        .spawn()
        .map_err(|_| "Não foi possível iniciar o conector Cloudflare".to_string())?;
        *guard = Some(child);
        Ok(())
    }
    pub fn configure_tunnel(&self, token: &str) -> Result<(), String> {
        let value = token.trim();
        if value.len() < 64
            || value.len() > 8192
            || !value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"+/=_-".contains(&b))
        {
            return Err("Token do túnel inválido".into());
        }
        fs::write(self.dir.join("tunnel.token"), value)
            .map_err(|_| "Não foi possível salvar o token".to_string())?;
        self.start_tunnel()
    }
    pub fn status(&self) -> serde_json::Value {
        let running = self
            .tunnel
            .lock()
            .ok()
            .and_then(|mut g| g.as_mut().map(|c| matches!(c.try_wait(), Ok(None))))
            .unwrap_or(false);
        serde_json::json!({"tunnelConfigured":self.dir.join("tunnel.token").exists(),"tunnelRunning":running,"dataDir":self.dir})
    }
    pub fn stop(&self) {
        for lock in [&self.tunnel, &self.backend] {
            if let Ok(mut guard) = lock.lock() {
                if let Some(mut child) = guard.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    }
}
