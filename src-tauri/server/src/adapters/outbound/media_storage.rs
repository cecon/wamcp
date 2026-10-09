//! Attachment files: on disk under the app data directory, or in memory for tests.
use crate::application::ports::MediaStorage;
use crate::domain::error::{fail, Error, Result};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

/// Only plain relative paths below the data directory (no `..`, roots or drive prefixes).
fn checked(path: &str) -> Result<&Path> {
    let relative = Path::new(path);
    if path.is_empty() || !relative.components().all(|c| matches!(c, Component::Normal(_))) {
        return fail("Caminho de anexo inválido");
    }
    Ok(relative)
}

/// Files under `<data dir>/media/<session>/<YYYY>/<MM>/…`.
pub struct FsMediaStorage {
    root: PathBuf,
}

impl FsMediaStorage {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }
}

impl MediaStorage for FsMediaStorage {
    fn save(&self, path: &str, bytes: &[u8]) -> Result<()> {
        let target = self.root.join(checked(path)?);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(Error::internal)?;
        }
        // Write to a temporary file first so a crash never leaves a truncated attachment.
        let partial = target.with_extension("partial");
        std::fs::write(&partial, bytes).map_err(Error::internal)?;
        std::fs::rename(&partial, &target).map_err(Error::internal)
    }

    fn read(&self, path: &str) -> Result<Option<Vec<u8>>> {
        match std::fs::read(self.root.join(checked(path)?)) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(Error::internal(error)),
        }
    }
}

/// Keeps files in memory (tests and runs without a data directory).
#[derive(Default)]
pub struct MemoryMediaStorage {
    pub files: Mutex<HashMap<String, Vec<u8>>>,
}

impl MediaStorage for MemoryMediaStorage {
    fn save(&self, path: &str, bytes: &[u8]) -> Result<()> {
        checked(path)?;
        self.files.lock().insert(path.into(), bytes.to_vec());
        Ok(())
    }

    fn read(&self, path: &str) -> Result<Option<Vec<u8>>> {
        checked(path)?;
        Ok(self.files.lock().get(path).cloned())
    }
}
