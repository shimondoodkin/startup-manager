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
- tmux: native on Linux/macOS, or a Cygwin/MSYS `tmux.exe` on Windows (set `TMUX_PATH`)
- Modern web browser

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
# Windows only: path to a Cygwin/MSYS tmux.exe
TMUX_PATH=C:/ProgramFilesFolder/itmux/bin/tmux.exe
```

### Windows notes

- Programs are typed into a Cygwin `bash` inside the tmux session, so use
  Cygwin-style paths and invoke native tools explicitly, e.g.
  `/cygdrive/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -File C:/jobs/run.ps1`.
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
npm run smctl -- start my-job
npm run smctl -- logs my-job -n 100
npm run smctl -- send my-job "some input"
npm run smctl -- stop my-job
npm run smctl -- kill my-job
```

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
