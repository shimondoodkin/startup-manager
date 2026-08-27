# Rust integration example

How a Rust application shows a live "jobs board" of everything startup-manager
keeps running — without linking against it, talking to its WebSocket API, or
sharing a process with it.

This is the pattern we use in production for a trading desk UI: the desk has a
tab that lists every managed job (name, status, command, autostart) with a
green/grey/amber dot per job.

## The pattern: export job + file poller

Coupling a GUI app directly to the manager's socket API means reconnect logic,
auth, and a hard dependency on the manager being up. Instead, split it:

1. **An export job inside startup-manager** runs
   [`scripts/sm-export.ts`](../../scripts/sm-export.ts) in a loop. Every 60s it
   dumps the program roster to a JSON file — written atomically (temp file,
   then rename), so a reader can never see a half-written file:

   ```json
   {
     "updated_ms": 1756270000000,
     "jobs": [
       { "name": "hello-loop", "status": "running",
         "session": "hello-loop", "command": "while true; do date; sleep 5; done",
         "autostart": false }
     ]
   }
   ```

   Register it like any other program (see `status-export` in the repo's
   sample [`config.json`](../../config.json)), or via smctl:

   ```bash
   npm run smctl -- add status-export 'while true; do npm run --silent sm-export -- status/startup.json; sleep 60; done'
   ```

2. **The Rust app polls the file** on a background thread and keeps the latest
   parsed snapshot behind an `Arc<Mutex<…>>` for the UI thread to clone.
   Three states, never an error dialog:
   - file missing / torn → "waiting for data" (the export job may not have run yet)
   - `updated_ms` older than 3 minutes → stale banner (the export job died)
   - fresh → render the board

The file is the whole interface. Either side can restart freely; the manager
does not know the Rust app exists.

## Run it

```bash
# terminal 1: start startup-manager, then start the status-export job in the UI
npm run start:prod

# terminal 2:
cd examples/rust-integration
cargo run -- ../../status/startup.json
```

Output refreshes every 5 seconds:

```
jobs board (updated 12s ago)
  ● hello-loop      running    while true; do date; sleep 5; done
  ○ old-batch       stopped    ./batch.sh
```

## Controlling jobs from scripts

For the write direction (register/start/stop jobs from your own tooling), shell
out to `smctl` — it drives the same RPC the web UI uses. Our watchdog and
pipeline scripts self-register this way:

```bash
npm run smctl -- add my-worker './target/release/my-worker 2>&1 | tee -a logs/my-worker.log'
npm run smctl -- autostart my-worker on
npm run smctl -- restart my-worker
```

`smctl` reads the server URL and credentials from the same `.env` the server
uses, so scripts need no extra configuration.
