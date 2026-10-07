//! Starts the backend: opens the database, connects WhatsApp, and serves the admin listener
//! (127.0.0.1:17381, desktop only) and the public listener (127.0.0.1:17382, behind the tunnel).
use crate::adapters::outbound::clock::SystemClock;
use crate::adapters::outbound::event_callback::HttpEventCallback;
use crate::adapters::outbound::password::ScryptHasher;
use crate::adapters::outbound::sqlite::SqliteStore;
use crate::adapters::outbound::webhook_sender::HttpWebhookSender;
use crate::application::crypto::{base64url, random_bytes};
use crate::application::ports::WhatsApp;
use crate::compose::{compose, App, Ports, Settings};
use crate::domain::error::{Error, Result};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::watch;
use tokio::task::JoinHandle;

pub const PUBLIC_URL: &str = "https://wamcp.cappyfy.com";

pub struct Config {
    pub data_dir: PathBuf,
    pub admin_token: Option<String>,
    pub admin_port: u16,
    pub public_port: u16,
    pub public_url: String,
    /// Directories searched (in order) for the built agent UI (`agent.html`).
    pub web_dirs: Vec<PathBuf>,
}

impl Config {
    /// Defaults plus `WAMCP_*` environment overrides, like the Node service.
    pub fn from_env() -> Self {
        let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
        let port = |name: &str, default| std::env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(default);
        let mut web_dirs: Vec<PathBuf> = std::env::var_os("WAMCP_WEB_DIR").map(PathBuf::from).into_iter().collect();
        if let Some(exe) = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf)) {
            web_dirs.push(exe.join("runtime").join("web"));
            web_dirs.push(exe.join("web"));
        }
        web_dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../dist"));
        Self {
            data_dir: std::env::var_os("WAMCP_DATA_DIR").map(PathBuf::from).unwrap_or_else(|| base.join("com.cappyfy.wamcp")),
            admin_token: std::env::var("WAMCP_ADMIN_TOKEN").ok().filter(|t| !t.is_empty()),
            admin_port: port("WAMCP_ADMIN_PORT", 17381),
            public_port: port("WAMCP_MCP_PORT", 17382),
            public_url: PUBLIC_URL.into(),
            web_dirs,
        }
    }
}

/// Reads `admin.token` from the data directory, creating a random one on first start.
pub fn admin_token(dir: &Path) -> Result<String> {
    let path = dir.join("admin.token");
    if !path.exists() {
        std::fs::write(&path, base64url(&random_bytes(32))).map_err(Error::internal)?;
    }
    Ok(std::fs::read_to_string(&path).map_err(Error::internal)?.trim().to_string())
}

/// A running backend; dropping `stop` (or calling it) shuts the listeners down gracefully.
pub struct Running {
    pub app: Arc<App>,
    pub admin_addr: SocketAddr,
    pub public_addr: SocketAddr,
    stop: watch::Sender<bool>,
    tasks: Vec<JoinHandle<()>>,
}

impl Running {
    pub async fn stop(self) {
        let _ = self.stop.send(true);
        for task in self.tasks {
            task.abort();
        }
        if let Some(events) = &self.app.state.events {
            events.close();
        }
    }
}

#[cfg(feature = "whatsapp")]
fn whatsapp_port(dir: &Path, repo: Arc<SqliteStore>) -> Arc<crate::adapters::outbound::whatsapp::client::WhatsAppClients> {
    Arc::new(crate::adapters::outbound::whatsapp::client::WhatsAppClients::new(dir.join("wa"), repo))
}

async fn serve(router: axum::Router, port: u16, mut stop: watch::Receiver<bool>) -> Result<(SocketAddr, JoinHandle<()>)> {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.map_err(Error::internal)?;
    let address = listener.local_addr().map_err(Error::internal)?;
    let service = router.into_make_service_with_connect_info::<SocketAddr>();
    let task = tokio::spawn(async move {
        let shutdown = async move {
            let _ = stop.changed().await;
        };
        let _ = axum::serve(listener, service).with_graceful_shutdown(shutdown).await;
    });
    Ok((address, task))
}

pub async fn run(config: Config) -> Result<Running> {
    std::fs::create_dir_all(&config.data_dir).map_err(Error::internal)?;
    let admin_token = match config.admin_token {
        Some(token) => token,
        None => admin_token(&config.data_dir)?,
    };
    if admin_token.len() < 32 {
        return Err(Error::internal("Admin token must have at least 32 characters"));
    }
    let store = Arc::new(SqliteStore::open(&config.data_dir)?);
    #[cfg(feature = "whatsapp")]
    let clients = whatsapp_port(&config.data_dir, store.clone());
    #[cfg(feature = "whatsapp")]
    let whatsapp: Arc<dyn WhatsApp> = clients.clone();
    #[cfg(not(feature = "whatsapp"))]
    let whatsapp: Arc<dyn WhatsApp> = Arc::new(crate::adapters::outbound::whatsapp::memory::MemoryWhatsApp::default());
    let web_dirs = config.web_dirs.clone();
    let ports = Ports {
        repo: store,
        whatsapp,
        hasher: Arc::new(ScryptHasher),
        sender: Arc::new(HttpWebhookSender::new()),
        callback: Arc::new(HttpEventCallback),
        clock: Arc::new(SystemClock),
    };
    let settings = Settings {
        public_url: config.public_url,
        admin_token,
        version: env!("CARGO_PKG_VERSION").into(),
        web_dir: Arc::new(move || web_dirs.iter().find(|d| d.join("agent.html").exists()).cloned()),
    };
    let app = Arc::new(compose(ports, settings));
    #[cfg(feature = "whatsapp")]
    clients.attach(app.sink.clone());
    let (stop, receiver) = watch::channel(false);
    let (admin_addr, admin) = serve(app.admin_router(), config.admin_port, receiver.clone()).await?;
    let (public_addr, public) = serve(app.public_router(), config.public_port, receiver).await?;
    let mut tasks = app.start_jobs();
    tasks.extend([admin, public]);
    #[cfg(feature = "whatsapp")]
    clients.restore().await;
    tracing::info!("WA MCP: serviço local iniciado.");
    Ok(Running { app, admin_addr, public_addr, stop, tasks })
}
