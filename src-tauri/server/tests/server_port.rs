//! The server refuses to start when another program already answers on its port locally.
use std::net::{IpAddr, Ipv4Addr};
use wamcp_server::server::{run, Config};

fn config(dir: &std::path::Path, bind: IpAddr, port: u16) -> Config {
    Config {
        data_dir: dir.to_path_buf(),
        bind,
        port,
        public_url: "https://wamcp.test".into(),
        crawler: None,
        web_dirs: Vec::new(),
    }
}

#[tokio::test]
async fn a_port_taken_on_localhost_is_reported_instead_of_shadowed() {
    let taken = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let port = taken.local_addr().unwrap().port();
    let dir = tempfile::tempdir().unwrap();
    let error = run(config(dir.path(), IpAddr::V4(Ipv4Addr::UNSPECIFIED), port))
        .await
        .err()
        .expect("must not start");
    assert!(error.to_string().contains(&format!("porta {port}")), "{error}");
    drop(taken);
    let running = run(config(dir.path(), IpAddr::V4(Ipv4Addr::UNSPECIFIED), port))
        .await
        .expect("starts once the port is free");
    assert_eq!(running.addr.port(), port);
    let healthy = tokio::net::TcpStream::connect((Ipv4Addr::LOCALHOST, port)).await;
    assert!(healthy.is_ok());
    running.stop().await;
}
