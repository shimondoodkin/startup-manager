import { execFile } from 'child_process';
import * as fs from 'fs';
import logger from './logger';

/**
 * Delivering POSIX signals to the program running inside a tmux pane.
 *
 * tmux reports `#{pane_pid}`: the shell tmux spawned in the pane, not the
 * program the user actually started. Signalling that shell does nothing
 * useful - an interactive bash ignores SIGINT while a foreground job runs, and
 * SIGHUP to it would tear down the session rather than the job.
 *
 * What Ctrl+C really does is signal the *foreground process group* of the
 * terminal, so that is what we resolve here. The pane shell's `tpgid` is
 * exactly that group id: on Linux it is field 8 of /proc/<pid>/stat, and
 * `ps -o tpgid=` is the portable fallback (macOS, or a hidden /proc).
 */

/** Foreground process group of the terminal owned by `panePid`, if any. */
export async function foregroundProcessGroup(panePid: number): Promise<number | undefined> {
  if (process.platform === 'win32') return undefined;
  if (!Number.isInteger(panePid) || panePid <= 0) return undefined;

  const tpgid = tpgidFromProc(panePid) ?? (await tpgidFromPs(panePid));
  // -1 means "no foreground group" (the tty was orphaned or detached).
  return tpgid !== undefined && tpgid > 0 ? tpgid : undefined;
}

/**
 * Send `signal` to the pane's foreground job, falling back to the pane shell
 * when the foreground group cannot be resolved. Returns a description of what
 * was signalled, for logging. Throws whatever process.kill throws (ESRCH when
 * the target already exited, EPERM when it is not ours).
 */
export async function signalForeground(panePid: number, signal: NodeJS.Signals): Promise<string> {
  const pgid = await foregroundProcessGroup(panePid);
  if (pgid !== undefined) {
    process.kill(-pgid, signal); // negative pid = "the whole process group", like Ctrl+C
    return `process group ${pgid}`;
  }
  process.kill(panePid, signal);
  return `pid ${panePid}`;
}

/**
 * /proc/<pid>/stat field 8. The comm field (2) is parenthesised and may itself
 * contain spaces and ')', so everything is parsed relative to the *last* ')'.
 * Fields after it are: state, ppid, pgrp, session, tty_nr, tpgid.
 */
export function parseTpgidFromStat(stat: string): number | undefined {
  const close = stat.lastIndexOf(')');
  if (close === -1) return undefined;
  const fields = stat.slice(close + 1).trim().split(/\s+/);
  const tpgid = parseInt(fields[5], 10);
  return Number.isFinite(tpgid) ? tpgid : undefined;
}

function tpgidFromProc(pid: number): number | undefined {
  try {
    return parseTpgidFromStat(fs.readFileSync(`/proc/${pid}/stat`, 'utf-8'));
  } catch {
    return undefined; // not Linux, or the process is gone - fall back to ps
  }
}

function tpgidFromPs(pid: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'tpgid=', '-p', String(pid)], { windowsHide: true }, (error, stdout) => {
      if (error) {
        logger.debug(`ps -o tpgid= -p ${pid} failed: ${error.message}`, { category: 'program' });
        return resolve(undefined);
      }
      const tpgid = parseInt(String(stdout).trim(), 10);
      resolve(Number.isFinite(tpgid) ? tpgid : undefined);
    });
  });
}
