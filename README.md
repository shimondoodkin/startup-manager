# Startup Manager

A Next.js application for managing and monitoring programs running on your server with tmux session integration (Linux, macOS and Windows).

## Features

- Web-based management of services and programs
- Run programs in named tmux sessions
- Monitor program status in real-time
- Start, stop, and terminate programs
- Connect to program terminals through the web interface
- WebSocket-based RPC API for real-time communications
- Authentication system to secure access

## Requirements

- Node.js 18+ and npm
- tmux 2.1+: native on Linux/macOS, or a Cygwin/MSYS `tmux.exe` on Windows (set `TMUX_PATH`)
- Modern web browser

The server logs the detected tmux version at startup, and logs an error if the
binary cannot be found - check that line first if programs refuse to start.

## Setup

1. Clone the repository:

```bash
git clone <repository-url>
cd startup-manager
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file in the project root with the following variables:

```
ADMIN_USERNAME=admin
ADMIN_PASSWORD=yourSecurePassword
CONFIG_PATH=/path/to/config/directory/programs.json
PORT=3000
# Linux/macOS: leave TMUX_PATH unset to use the tmux on PATH.
# Windows only: path to a Cygwin/MSYS tmux.exe
TMUX_PATH=C:/ProgramFilesFolder/itmux/bin/tmux.exe
```

### Linux notes

- Install tmux from your package manager - `sudo apt install tmux`,
  `sudo dnf install tmux`, `sudo pacman -S tmux`. Leave `TMUX_PATH` unset; the
  plain `tmux` on `PATH` is used.
- Sessions run under your login shell (tmux's `default-shell`), so commands are
  written exactly as you would type them in a terminal.
- Stop honours the program's stop method. `SIGINT`/`SIGHUP` are delivered to the
  pane's *foreground process group* - the same target Ctrl+C uses - not to the
  pane's shell, so they reach the program and any pipeline it started.
- `node-pty` compiles from source on Linux if no prebuilt binary matches your
  Node version: `sudo apt install build-essential python3` first.
- Run `./start-manager.sh` for a one-shot install-build-start, or install
  `deploy/startup-manager.service` for a systemd unit that survives reboots. The
  server shuts down cleanly on `SIGTERM`, so `systemctl stop` is safe; tmux
  sessions keep running.

### Windows notes

- Windows has no tmux package. Run `install-tmux.bat` (or
  `.\install-tmux.ps1`) to download the itmux bundle from itefix.net into
  `tools\itmux`, verify it runs, and set `TMUX_PATH` in `.env`. It needs no
  administrator rights and writes nothing outside the repository. The script
  prints the download's SHA-256; pass it back as `-ExpectedSha256` to have
  later runs verify the archive.
- Programs are typed into a Cygwin `bash` inside the tmux session, so use
  Cygwin-style paths and invoke native tools explicitly, e.g.
  `/cygdrive/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -File C:/jobs/run.ps1`.
- The session shell runs with the tmux bundle's `bin` directory prepended to
  `PATH`, so Cygwin tools resolve first and the Windows `PATH` stays reachable
  behind them. If you change `TMUX_PATH`, run `tmux kill-server` before existing
  sessions pick up the new value - the tmux server caches the environment it
  started with.
- **itmux is a trimmed Cygwin bundle, not a full one.** It ships `bash`, `date`,
  `grep`, `sed`, `ps`, `ls`, `cat`, `tail`, `sort`, `cut`, `tr`, `wc`, `diff`,
  `tar`, `ssh` and `nano` - but **no `sleep`**, so a poll loop written as
  `while true; do work; sleep 60; done` fails on Windows with
  `bash: sleep: command not found`. Use `ping -n 61 127.0.0.1 >/dev/null` in its
  place, or install full Cygwin and point `TMUX_PATH` at its `tmux.exe`. The
  sample commands in `config.json` use `sleep` and are Linux-only as written.
- Stop always sends Ctrl+C to the session (POSIX signals are not available).
- `node-pty` ships prebuilt binaries for Windows; no Visual Studio needed.

## Running the Application

### Development Mode

To run the application in development mode with hot-reloading:

```bash
npm run dev:server
```

### Production Mode

Build the application for production:

```bash
npm run build
npm run build:server
```

Start the production server:

```bash
npm run start:prod
```

## Usage

1. Open your browser and navigate to `http://localhost:3000` (or the configured port)
2. Login with the credentials set in the `.env` file
3. Use the UI to manage your programs:
   - Add new programs with a name, command, and screen name
   - Start/stop existing programs
   - Monitor program status in real-time
   - Connect to terminal sessions for running programs

## CLI

`smctl` drives the running server from the command line using the same RPC as the UI:

```bash
npm run smctl -- list
npm run smctl -- add my-job "python worker.py"
npm run smctl -- start my-job
npm run smctl -- logs my-job -n 100
npm run smctl -- send my-job "some input"
npm run smctl -- stop my-job
npm run smctl -- kill my-job
```

`add` takes `--stop CTRL_C|SIGINT|SIGHUP`. `CTRL_C` is the default and the only
method Windows supports; on Linux/macOS `SIGINT` and `SIGHUP` are delivered to
the pane's foreground process group.

It reads `ADMIN_USERNAME`, `ADMIN_PASSWORD` and `PORT` from `.env` (override the URL with `SM_URL`).

`sm-export` dumps the program roster as a JSON snapshot, written atomically so other
programs can poll it as a status feed:

```bash
npm run sm-export -- status/startup.json
```

## Integrating with your own app

Your application can show a live board of everything startup-manager keeps running
without touching the socket API: run `sm-export` in a loop as a managed job, and poll
the JSON file it writes. [examples/rust-integration](examples/rust-integration/) is a
complete Rust program using this pattern (background poller thread, torn-file and
staleness handling) — it is a distilled version of what we run in production.

## API

The application provides a WebSocket-based RPC API with the following methods:

- `listPrograms`: Get a list of all configured programs
- `addProgram`: Add a new program
- `editProgram`: Update an existing program
- `deleteProgram`: Delete a program
- `startProgram`: Start a program in its tmux session
- `stopProgram`: Send SIGINT to a running program
- `terminateProgram`: Kill a running program
- `getProgramStatus`: Get the current status of a program
- `startScreen`: Start a new tmux session for a program
- `sendCommandToScreen`: Send a command to a tmux session
- `getOutput`: Get the last N lines of a program's session output

## License

MIT
