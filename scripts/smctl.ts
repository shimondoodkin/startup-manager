#!/usr/bin/env ts-node
/**
 * smctl - command-line client for startup-manager.
 *
 * Talks to the running server over the same socket.io RPC the web UI uses, so
 * the CLI and the browser always see the same state.
 *
 *   smctl list                      show all programs and their status
 *   smctl status <name|id>          refresh and show one program (JSON)
 *   smctl start <name|id>           start the program in its tmux session
 *   smctl stop <name|id>            graceful stop (Ctrl+C / configured signal)
 *   smctl restart <name|id>         stop then start
 *   smctl kill <name|id>            kill the whole tmux session
 *   smctl logs <name|id> [-n N]     print the last N lines of output (default 200)
 *   smctl send <name|id> <text...>  type text into the session and press Enter
 *   smctl add <name> <command> [--session s] [--autostart]
 *   smctl rm <name|id>
 *   smctl autostart <name|id> on|off
 *   smctl session <name|id>         start the session without running the command
 *
 * Connection settings come from .env / environment:
 *   SM_URL (default http://localhost:$PORT), ADMIN_USERNAME, ADMIN_PASSWORD
 */
import { io, Socket } from 'socket.io-client';
import * as path from 'path';
import * as fs from 'fs';

// Load .env from the project root if present (same file the server uses).
try {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch { /* ignore */ }

const URL = process.env.SM_URL || `http://localhost:${process.env.PORT || 3000}`;
const USER = process.env.ADMIN_USERNAME || 'admin';
const PASS = process.env.ADMIN_PASSWORD || '';

interface ProgramState {
  id: string; name: string; command: string; screenName: string; autoStart?: boolean;
  stopMethod?: string; pid?: number; status: string; screenActive: boolean; foregroundCommand?: string;
}

function usage(code = 1): never {
  console.error(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 21).map(l => l.replace(/^ \*\s?/, '')).join('\n'));
  process.exit(code);
}

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(URL, {
      path: '/api/programs/socket.io',
      transports: ['websocket'],
      auth: { username: USER, password: PASS },
      reconnection: false,
      timeout: 5000,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => reject(new Error(`cannot connect to ${URL}: ${err.message}`)));
  });
}

let rpcId = 0;
function rpc<T = any>(socket: Socket, method: string, params: any = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.emit('rpc', { id: ++rpcId, method, params }, (resp: any) => {
      if (resp?.error) reject(new Error(resp.error));
      else resolve(resp.result);
    });
  });
}

async function resolveProgram(socket: Socket, ref: string): Promise<ProgramState> {
  const list = await rpc<ProgramState[]>(socket, 'listPrograms');
  const found = list.find(p => p.id === ref) || list.find(p => p.name === ref) || list.find(p => p.screenName === ref);
  if (!found) throw new Error(`no program named "${ref}" (use \`smctl list\`)`);
  return found;
}

function printTable(list: ProgramState[]) {
  const rows = list.map(p => [p.name, p.status + (p.screenActive && p.status !== 'running' ? ' (session idle)' : ''), p.foregroundCommand || '', p.screenName, p.command]);
  const head = ['NAME', 'STATUS', 'FOREGROUND', 'SESSION', 'COMMAND'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
  const fmt = (r: string[]) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join('  ');
  console.log(fmt(head));
  for (const r of rows) console.log(fmt(r));
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === '-h' || cmd === '--help') usage(0);

  const socket = await connect();
  try {
    switch (cmd) {
      case 'list': {
        printTable(await rpc<ProgramState[]>(socket, 'listPrograms'));
        break;
      }
      case 'status': {
        const p = await resolveProgram(socket, rest[0] || usage());
        console.log(JSON.stringify(await rpc(socket, 'getProgramStatus', { id: p.id }), null, 2));
        break;
      }
      case 'restart': {
        const p = await resolveProgram(socket, rest[0] || usage());
        await rpc(socket, 'stopProgram', { id: p.id });
        // wait for the process to actually die — starting into a busy pane types the
        // command into the dying program's stdin and runs garbage when it exits
        for (let i = 0; i < 20; i++) {
          const s: ProgramState = await rpc(socket, 'getProgramStatus', { id: p.id });
          if (s.status !== 'running') break;
          await new Promise((res) => setTimeout(res, 500));
        }
        const r = await rpc(socket, 'startProgram', { id: p.id });
        const state: ProgramState = r.state || r;
        console.log(`${p.name}: ${state.status}`);
        break;
      }
      case 'start': case 'stop': case 'kill': case 'session': {
        const p = await resolveProgram(socket, rest[0] || usage());
        const method = { start: 'startProgram', stop: 'stopProgram', kill: 'terminateProgram', session: 'startScreen' }[cmd]!;
        const r = await rpc(socket, method, { id: p.id });
        const state: ProgramState = r.state || r;
        console.log(`${p.name}: ${state.status}${state.screenActive ? '' : ' (no session)'}`);
        if (cmd === 'stop' && state.status === 'running') process.exitCode = 2;
        break;
      }
      case 'logs': {
        const p = await resolveProgram(socket, rest[0] || usage());
        const nIdx = rest.indexOf('-n');
        const lines = nIdx >= 0 ? parseInt(rest[nIdx + 1], 10) : 200;
        const r = await rpc<{ output: string | null }>(socket, 'getOutput', { id: p.id, lines });
        if (r.output === null) { console.error(`${p.name}: no session`); process.exitCode = 2; }
        else process.stdout.write(r.output.replace(/\s+$/, '') + '\n');
        break;
      }
      case 'send': {
        const p = await resolveProgram(socket, rest[0] || usage());
        const text = rest.slice(1).join(' ');
        if (!text) usage();
        const r = await rpc(socket, 'sendCommandToScreen', { id: p.id, command: text });
        console.log(r.success ? 'sent' : 'failed');
        if (!r.success) process.exitCode = 2;
        break;
      }
      case 'add': {
        const [name, command] = rest;
        if (!name || !command) usage();
        const sIdx = rest.indexOf('--session');
        const screenName = sIdx >= 0 ? rest[sIdx + 1] : name.replace(/[^A-Za-z0-9_-]/g, '-');
        const autoStart = rest.includes('--autostart');
        const r = await rpc(socket, 'addProgram', { name, command, screenName, autoStart, stopMethod: 'CTRL_C' });
        console.log(`added ${r.name} (${r.id}) session=${r.screenName}`);
        break;
      }
      case 'autostart': {
        const p = await resolveProgram(socket, rest[0] || usage());
        if (!['on', 'off'].includes(rest[1])) usage();
        const r = await rpc(socket, 'editProgram', { id: p.id, autoStart: rest[1] === 'on' });
        console.log(`${r.name}: autoStart=${r.autoStart}`);
        break;
      }
      case 'rm': {
        const p = await resolveProgram(socket, rest[0] || usage());
        await rpc(socket, 'deleteProgram', { id: p.id });
        console.log(`removed ${p.name}`);
        break;
      }
      default:
        usage();
    }
  } finally {
    socket.close();
  }
}

main().catch((err) => {
  console.error(`smctl: ${err.message}`);
  process.exit(1);
});
