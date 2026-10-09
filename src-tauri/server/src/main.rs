//! Standalone backend (development, CI and headless use). The desktop app embeds the same server.
use wamcp_server::server::{run, Config};

#[tokio::main]
async fn main() {
    let running = match run(Config::from_env()).await {
        Ok(running) => running,
        Err(error) => {
            eprintln!("Falha ao iniciar serviço: {error}");
            std::process::exit(1);
        }
    };
    println!("WA MCP: serviço em http://{}/app/", running.addr);
    let _ = tokio::signal::ctrl_c().await;
    running.stop().await;
}
