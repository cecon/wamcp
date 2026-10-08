//! Starts the backend: opens the database, connects WhatsApp, and serves the single listener used
//! by the desktop window, the local network (`0.0.0.0:17382` by default) and the tunnel.
use crate::adapters::outbound::clock::SystemClock;
use crate::adapters::outbound::event_callback::HttpEventCallback;
use crate::adapters::outbound::password::ScryptHasher;
use crate::adapters::outbound::sqlite::SqliteStore;
use crate::adapters::outbound::webhook_sender::HttpWebhookSender;
use crate::application::ports::WhatsApp;
use crate::compose::{compose, App, Ports, Settings};
use crate::domain::error::{Error, Result};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::watch;
use tokio::task::JoinHandle;

pub const PUBLIC_URL: &str = "https://wamcp.cappyfy.com";

pub struct Config {
    pub data_dir: PathBuf,
    /// Address to listen on: `0.0.0.0` serves the local network, `127.0.0.1` only this computer.
    pub bind: IpAddr,
    pub port: u16,
    pub public_url: String,
    /// Directories searched (in order) for the built web app (`index.html`).
    pub web_dirs: Vec<PathBuf>,
}

impl Config {
    /// Defaults plus `WAMCP_*` environment overrides, like the Node service.
    pub fn from_env() -> Self {
        let base = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        let port = |name: &str, default| std::env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(default);
        let mut web_dirs: Vec<PathBuf> = std::env::var_os("WAMCP_WEB_DIR")
            .map(PathBuf::from)
            .into_iter()
            .collect();
        if let Some(exe) = std::env::current_exe()
            .ok()
            .and_then(|e| e.parent().map(Path::to_path_buf))
        {
            web_dirs.push(exe.join("runtime").join("web"));
            web_dirs.push(exe.join("web"));
        }
        web_dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../dist"));
        Self {
            data_dir: std::env::var_os("WAMCP_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| base.join("com.cappyfy.wamcp")),
            bind: std::env::var("WAMCP_BIND")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED)),
            port: port("WAMCP_PORT", port("WAMCP_MCP_PORT", 17382)),
            public_url: PUBLIC_URL.into(),
            web_dirs,
        }
    }
}

/// A running backend; dropping `stop` (or calling it) shuts the listeners down gracefully.
pub struct Running {
    pub app: Arc<App>,
    pub addr: SocketAddr,
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
fn whatsapp_port(
    dir: &Path,
    repo: Arc<SqliteStore>,
) -> Arc<crate::adapters::outbound::whatsapp::client::WhatsAppClients> {
    Arc::new(crate::adapters::outbound::whatsapp::client::WhatsAppClients::new(
        dir.join("wa"),
        repo,
    ))
}

async fn serve(
    router: axum::Router,
    bind: IpAddr,
    port: u16,
    mut stop: watch::Receiver<bool>,
) -> Result<(SocketAddr, JoinHandle<()>)> {
    let listener = tokio::net::TcpListener::bind((bind, port))
        .await
        .map_err(Error::internal)?;
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
        storage: Arc::new(crate::adapters::outbound::media_storage::FsMediaStorage::new(
            &config.data_dir,
        )),
    };
    let settings = Settings {
        public_url: config.public_url,
        version: env!("CARGO_PKG_VERSION").into(),
        web_dir: Arc::new(move || web_dirs.iter().find(|d| d.join("index.html").exists()).cloned()),
    };
    let app = Arc::new(compose(ports, settings));
    #[cfg(feature = "whatsapp")]
    clients.attach(app.sink.clone());
    let (stop, receiver) = watch::channel(false);
    let (addr, server) = serve(app.public_router(), config.bind, config.port, receiver).await?;
    let mut tasks = app.start_jobs();
    tasks.push(server);
    #[cfg(feature = "whatsapp")]
    clients.restore().await;
    tracing::info!("WA MCP: serviço local iniciado.");
    Ok(Running { app, addr, stop, tasks })
}
