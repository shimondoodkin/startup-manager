//! A Rust app showing startup-manager's job roster — the file-poller pattern.
//!
//! `sm-export` (running as a job inside startup-manager) writes the roster to a JSON
//! file every 60s, atomically (temp file + rename). This app polls that file on a
//! background thread and keeps the latest parsed snapshot behind an `Arc<Mutex<…>>`,
//! exactly the shape a GUI app wants: the render loop clones the snapshot and never
//! blocks on IO. Here the "GUI" is a terminal print every 5 seconds.
//!
//! The three states, deliberately none of them an error:
//! - file missing or half-written  -> "waiting for data" (the export job may not have run yet)
//! - stamp older than three minutes -> stale banner (the export job died; go look)
//! - fresh                          -> render the board
//!
//! Usage: cargo run -- /path/to/startup.json

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;

/// Jobs start and stop on the pace of humans, not the pace of the machine — a 5s poll
/// is plenty, and the export job only rewrites the file every 60s anyway.
const POLL: Duration = Duration::from_secs(5);
/// The export job writes every 60s; three missed writes means it is down, not slow.
const STALE_MS: i64 = 3 * 60 * 1000;

/// Everything the UI needs, cloned wholesale by the render loop.
#[derive(Clone, Default)]
struct Snapshot {
    /// `None` while the file is missing or torn — render "waiting", not an empty board.
    board: Option<Board>,
}

/// Mirrors the JSON `sm-export` writes: `{"updated_ms": …, "jobs": [...]}`.
/// Unknown fields (like `session`) are ignored, so the export format can grow.
#[derive(Clone, Deserialize)]
struct Board {
    updated_ms: i64,
    jobs: Vec<Job>,
}

#[derive(Clone, Deserialize)]
struct Job {
    name: String,
    /// startup-manager's own words: "running", "stopped", "stopped (session idle)", …
    status: String,
    command: String,
    autostart: bool,
}

/// Only the exact word "running" is green; every "stopped" variant is the calm grey of a
/// job that is *meant* to be down; anything unrecognized is amber — a status word we have
/// never seen is worth a look, not a panic.
#[derive(Clone, Copy, PartialEq)]
enum JobState {
    Running,
    Stopped,
    Other,
}

fn job_state(status: &str) -> JobState {
    if status == "running" {
        JobState::Running
    } else if status.starts_with("stopped") {
        JobState::Stopped
    } else {
        JobState::Other
    }
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64
}

/// Parse the roster; a missing or torn file is `None`, never an error — the writer may
/// simply not have run yet. Running jobs sort first, then alphabetical, so the top of
/// the board is what the machine is doing right now.
fn read_board(path: &Path) -> Option<Board> {
    let mut board: Board = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    board.jobs.sort_by(|a, b| {
        let rank = |j: &Job| (job_state(&j.status) != JobState::Running) as u8;
        rank(a).cmp(&rank(b)).then_with(|| a.name.cmp(&b.name))
    });
    Some(board)
}

/// The background poller a GUI app would spawn once at startup. It owns the IO; the UI
/// thread only ever locks, clones, and releases.
fn spawn_poller(path: PathBuf, shared: Arc<Mutex<Snapshot>>) {
    std::thread::spawn(move || loop {
        let snap = Snapshot {
            board: read_board(&path),
        };
        if let Ok(mut s) = shared.lock() {
            *s = snap;
        }
        std::thread::sleep(POLL);
    });
}

fn main() {
    let path = PathBuf::from(
        std::env::args()
            .nth(1)
            .unwrap_or_else(|| "status/startup.json".into()),
    );
    println!("watching {} (Ctrl+C to quit)", path.display());

    let shared = Arc::new(Mutex::new(Snapshot::default()));
    spawn_poller(path, Arc::clone(&shared));

    // Stand-in for a GUI render loop: clone the snapshot, draw, repeat.
    loop {
        std::thread::sleep(POLL);
        let snap = shared.lock().map(|s| s.clone()).unwrap_or_default();
        render(&snap);
    }
}

fn render(snap: &Snapshot) {
    let Some(board) = &snap.board else {
        println!("waiting for data… (export job not running yet, or file path wrong)");
        return;
    };
    let age_s = (now_ms() - board.updated_ms) / 1000;
    if now_ms() - board.updated_ms > STALE_MS {
        println!("!! STALE — last export {age_s}s ago; is the status-export job running?");
    }
    println!("\njobs board (updated {age_s}s ago)");
    for job in &board.jobs {
        let dot = match job_state(&job.status) {
            JobState::Running => "●",
            JobState::Stopped => "○",
            JobState::Other => "◐",
        };
        let auto = if job.autostart { "auto" } else { "    " };
        println!("  {dot} {:<16} {:<24} {auto}  {}", job.name, job.status, job.command);
    }
}
