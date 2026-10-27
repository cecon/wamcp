//! Finds a CLI on this computer: an override variable, a native executable on PATH (or the native
//! installer's `~/.local/bin`), or an npm global install run with Node directly. npm's `.cmd` shims
//! need a shell, which is never used, so on Windows only an `.exe` or Node plus the script qualify.
use std::path::{Path, PathBuf};
use tokio::process::Command;

/// The program to start and the arguments that come before the call's own.
#[derive(Debug, Clone, PartialEq)]
pub struct Launcher {
    pub program: PathBuf,
    pub args: Vec<String>,
}

impl Launcher {
    fn node(script: PathBuf, node: PathBuf) -> Self {
        Self {
            program: node,
            args: vec![script.to_string_lossy().into_owned()],
        }
    }

    pub fn command(&self) -> Command {
        let mut command = Command::new(&self.program);
        command.args(&self.args);
        #[cfg(windows)]
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        command
    }

    /// What the runtimes list shows: the script for npm installs, else the executable.
    pub fn describe(&self) -> String {
        self.args
            .first()
            .map_or_else(|| self.program.to_string_lossy().into_owned(), Clone::clone)
    }
}

/// Where to look for one CLI.
pub struct Cli<'a> {
    /// Environment variable with the program's path (an `.js`/`.mjs` path runs with Node).
    pub var: &'a str,
    /// Executable name without extension (`claude`).
    pub exe: &'a str,
    /// The npm package's entry script, relative to `node_modules` (`@scope/pkg/bin/x`).
    pub npm_script: Option<&'a str>,
}

fn path_dirs() -> Vec<PathBuf> {
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).collect())
        .unwrap_or_default()
}

fn executable(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.into()
    }
}

fn on_path(name: &str) -> Option<PathBuf> {
    path_dirs()
        .into_iter()
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
}

/// Node next to the npm prefix (nvm puts both in one folder), else the one on PATH.
fn node_for(prefix: &Path) -> Option<PathBuf> {
    let beside = prefix.join(executable("node"));
    if beside.is_file() {
        return Some(beside);
    }
    on_path(&executable("node"))
}

fn npm_install(script: &str) -> Option<Launcher> {
    let script: PathBuf = script.split('/').collect();
    for dir in path_dirs() {
        let candidates = [
            dir.join("node_modules").join(&script),
            dir.join("..").join("lib").join("node_modules").join(&script),
        ];
        if let Some(found) = candidates.into_iter().find(|c| c.is_file()) {
            return node_for(&dir).map(|node| Launcher::node(found, node));
        }
    }
    None
}

pub fn find(cli: &Cli) -> Option<Launcher> {
    if let Some(path) = std::env::var_os(cli.var).map(PathBuf::from) {
        let script = path.extension().is_some_and(|e| e == "js" || e == "mjs" || e == "cjs");
        return Some(match script.then(|| on_path(&executable("node"))).flatten() {
            Some(node) => Launcher::node(path, node),
            None => Launcher {
                program: path,
                args: Vec::new(),
            },
        });
    }
    let name = executable(cli.exe);
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" });
    let native = on_path(&name).or_else(|| {
        home.map(|h| PathBuf::from(h).join(".local").join("bin").join(&name))
            .filter(|candidate| candidate.is_file())
    });
    if let Some(program) = native {
        return Some(Launcher {
            program,
            args: Vec::new(),
        });
    }
    cli.npm_script.and_then(npm_install)
}
