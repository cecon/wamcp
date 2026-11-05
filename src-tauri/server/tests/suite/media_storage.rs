//! Attachments on disk: organised under `media/<session>/<YYYY>/<MM>/` in the app data directory.
use wamcp_server::adapters::outbound::media_storage::FsMediaStorage;
use wamcp_server::application::ports::MediaStorage;
use wamcp_server::domain::media::storage_path;

#[test]
fn files_are_written_atomically_below_the_data_directory() {
    let dir = tempfile::tempdir().unwrap();
    let storage = FsMediaStorage::new(dir.path());
    let path = storage_path("sessao-1", 1_800_000_000, "MSG1", "ogg");
    assert_eq!(path, "media/sessao-1/2027/01/MSG1.ogg");
    storage.save(&path, b"OggS...").unwrap();
    let on_disk = dir
        .path()
        .join("media")
        .join("sessao-1")
        .join("2027")
        .join("01")
        .join("MSG1.ogg");
    assert_eq!(std::fs::read(&on_disk).unwrap(), b"OggS...");
    assert!(
        !on_disk.with_extension("partial").exists(),
        "no leftover temporary file"
    );
    storage.save(&path, b"novo").unwrap();
    assert_eq!(storage.read(&path).unwrap(), Some(b"novo".to_vec()));
    assert_eq!(storage.read("media/sessao-1/2027/01/nada.ogg").unwrap(), None);
    for bad in ["", "../fora.txt", "media/../../fora.txt", "/etc/passwd"] {
        assert!(storage.save(bad, b"x").is_err(), "{bad}");
        assert!(storage.read(bad).is_err(), "{bad}");
    }
}
