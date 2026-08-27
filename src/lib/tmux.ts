import { execFile } from 'child_process';
import * as path from 'path';
import logger from './logger';

/**
 * Thin, cross-platform wrapper around the tmux CLI.
 *
 * Works with native tmux on Linux/macOS and with a Cygwin/MSYS tmux.exe on
 * Windows. All calls use execFile (no shell), so session names and commands
 * are passed as literal arguments and never re-interpreted by a shell.
 *
 * Session targets are prefixed with '=' so tmux matches the name exactly
 * instead of doing prefix/fuzzy matching.
 */
export interface PaneInfo {
  pid: number;
  currentCommand: string;
}

export class Tmux {
  constructor(private readonly binary: string = process.env.TMUX_PATH || 'tmux') {}

  /** tmux treats '.' and ':' specially in targets; refuse names that contain them. */
  validateSessionName(name: string): void {
    if (!name || /[.:\s]/.test(name)) {
      throw new Error(`Invalid tmux session name "${name}": must be non-empty and contain no '.', ':' or whitespace`);
    }
  }

  /**
   * Environment for tmux invocations.
   *
   * On Windows the session shell is the bundle's own bash.exe started with
   * --norc, so it inherits this PATH verbatim rather than building one from
   * /etc/profile. Without the bundle's bin directory on it, none of the Cygwin
   * tools a shell command takes for granted - date, sleep, grep - can be found,
   * and every program fails with "command not found". Prepending it keeps both
   * worlds reachable: Cygwin tools first, then the Windows PATH behind them.
   *
   * The tmux *server* inherits this from whichever command starts it, so after
   * changing TMUX_PATH run `tmux kill-server` before existing sessions pick it
   * up. On other platforms tmux is on PATH already; inherit the environment.
   */
  private env(): NodeJS.ProcessEnv | undefined {
    if (process.platform !== 'win32') return undefined;
    const dir = path.win32.dirname(path.win32.resolve(this.binary));
    // Windows env var names are case-insensitive, and Node preserves whatever
    // case the parent used, so find the real key instead of assuming 'PATH'.
    const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
    return { ...process.env, [key]: `${dir};${process.env[key] ?? ''}` };
  }

  private run(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      execFile(this.binary, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: this.env() }, (error, stdout, stderr) => {
        if (error && args[0] !== 'has-session') {
          logger.warn(`tmux ${args.join(' ')} failed: ${String(stderr || error.message).trim()}`, { category: 'tmux' });
        }
        resolve({ ok: !error, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      });
    });
  }

  async hasSession(name: string): Promise<boolean> {
    return (await this.run(['has-session', '-t', `=${name}`])).ok;
  }

  /**
   * Shell command run inside new sessions.
   *
   * On Windows (Cygwin/MSYS tmux) the default login shell reads the bundle's
   * /etc/profile, which typically resets PATH to /bin so no Windows tools are
   * reachable. Instead we run the bundle's own bash.exe (next to tmux.exe) as
   * a non-login interactive shell, which inherits the real PATH. Override with
   * TMUX_SHELL. On other platforms tmux's default shell is used.
   */
  sessionShell(): string | undefined {
    if (process.env.TMUX_SHELL) return process.env.TMUX_SHELL;
    if (process.platform !== 'win32') return undefined;
    // Always parse with the Windows rules: this branch describes a Windows
    // path even when it is exercised from a Linux test runner, where the
    // default `path` would treat the backslashes as part of the filename.
    const dir = path.win32.dirname(path.win32.resolve(this.binary));
    return `${toCygwinPath(path.win32.join(dir, 'bash.exe'))} --norc -i`;
  }

  async newSession(name: string): Promise<boolean> {
    this.validateSessionName(name);
    const shell = this.sessionShell();
    const args = ['new-session', '-d', '-s', name, ...(shell ? [shell] : [])];
    return (await this.run(args)).ok;
  }

  /** Type text into the session literally; optionally press Enter afterwards. */
  async sendKeys(name: string, text: string, enter = false): Promise<boolean> {
    const r = await this.run(['send-keys', '-t', `=${name}:`, '-l', text]);
    if (!r.ok) return false;
    if (enter) return (await this.run(['send-keys', '-t', `=${name}:`, 'Enter'])).ok;
    return true;
  }

  async sendCtrlC(name: string): Promise<boolean> {
    return (await this.run(['send-keys', '-t', `=${name}:`, 'C-c'])).ok;
  }

  async killSession(name: string): Promise<boolean> {
    return (await this.run(['kill-session', '-t', `=${name}`])).ok;
  }

  /** PID of the pane's shell and the name of the process currently in the foreground. */
  async paneInfo(name: string): Promise<PaneInfo | undefined> {
    const r = await this.run(['display-message', '-p', '-t', `=${name}:`, '#{pane_pid} #{pane_current_command}']);
    if (!r.ok) return undefined;
    const [pidStr, ...rest] = r.stdout.trim().split(/\s+/);
    const pid = parseInt(pidStr, 10);
    if (!Number.isFinite(pid)) return undefined;
    return { pid, currentCommand: rest.join(' ') };
  }

  /** Return up to `lines` lines of scrollback plus the visible screen. */
  async capturePane(name: string, lines = 1000): Promise<string | undefined> {
    const r = await this.run(['capture-pane', '-p', '-t', `=${name}:`, '-S', `-${lines}`, '-E', '-']);
    return r.ok ? r.stdout : undefined;
  }

  async version(): Promise<string | undefined> {
    const r = await this.run(['-V']);
    return r.ok ? r.stdout.trim() : undefined;
  }
}

/** C:\foo\bar -> /cygdrive/c/foo/bar (non-drive paths only get their slashes normalised) */
export function toCygwinPath(p: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (!m) return p.replace(/\\/g, '/');
  return `/cygdrive/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
}

let shared: Tmux | undefined;
export function getTmux(): Tmux {
  if (!shared) shared = new Tmux();
  return shared;
}
