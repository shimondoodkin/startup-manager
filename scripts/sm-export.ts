#!/usr/bin/env ts-node
/**
 * sm-export - dump the startup-manager program list as JSON to a file.
 *
 *   sm-export <output-file>
 *
 * Writes {"updated_ms": <now>, "jobs": [{name,status,session,command,autostart}...]}
 * atomically (tmp file then rename), so readers never see a torn file.
 *
 * Connection settings come from .env / environment (same as smctl):
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

async function main() {
  const outFile = process.argv[2];
  if (!outFile) {
    console.error('usage: sm-export <output-file>');
    process.exit(1);
  }

  const socket = await connect();
  try {
    const list = await rpc<ProgramState[]>(socket, 'listPrograms');
    const payload = {
      updated_ms: Date.now(),
      jobs: list.map(p => ({
        name: p.name,
        status: p.status,
        session: p.screenName,
        command: p.command,
        autostart: !!p.autoStart,
      })),
    };
    const tmp = outFile + '.tmp';
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n');
    fs.renameSync(tmp, outFile);
    console.log(`wrote ${payload.jobs.length} jobs -> ${outFile}`);
  } finally {
    socket.close();
  }
}

main().catch((err) => {
  console.error(`sm-export: ${err.message}`);
  process.exit(1);
});
