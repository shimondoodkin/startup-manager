import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { Tmux, getTmux } from './tmux';
import logger from './logger';

/** Program-category logger: `log.info(msg, extra?)` -> logger with category metadata. */
const log = {
  info: (msg: string, extra?: unknown) => logger.info(msg, { category: 'program', ...(extra !== undefined ? { extra: String(extra) } : {}) }),
  warn: (msg: string, extra?: unknown) => logger.warn(msg, { category: 'program', ...(extra !== undefined ? { extra: String(extra) } : {}) }),
  error: (msg: string, extra?: unknown) => logger.error(msg, { category: 'program', ...(extra !== undefined ? { extra: extra instanceof Error ? extra.stack || extra.message : String(extra) } : {}) }),
  debug: (msg: string, extra?: unknown) => logger.debug(msg, { category: 'program', ...(extra !== undefined ? { extra: String(extra) } : {}) }),
};
import treeKill from 'tree-kill';
import { EventEmitter } from 'events';

export type StopMethod = 'SIGINT' | 'SIGHUP' | 'CTRL_C';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Shell names that mean "nothing is running in the session right now". */
const IDLE_SHELLS = new Set(['bash', 'sh', 'zsh', 'fish', 'dash', 'ksh', 'tcsh', 'csh', 'bash.exe', 'sh.exe']);
export function isIdleShell(command: string): boolean {
  return IDLE_SHELLS.has(command.trim().toLowerCase());
}

export interface ProgramConfig {
  id: string;
  name: string;
  command: string;
  screenName: string;
  maxChildDepth?: number;
  autoStart?: boolean;
  stopMethod?: StopMethod;
}

export type ProgramStatus = 'running' | 'stopped' | 'error';

export interface ProgramState extends ProgramConfig {
  pid?: number;
  status: ProgramStatus;
  screenActive: boolean;
  foregroundCommand?: string;
}

export class Program extends EventEmitter {
  id: string;
  name: string;
  command: string;
  screenName: string;
  maxChildDepth: number;
  autoStart: boolean;
  stopMethod: StopMethod;
  private pid?: number;
  private status: ProgramStatus = 'stopped';
  private screenActive: boolean = false;
  private foregroundCommand?: string;
  private statusChangeCallback: ((program: ProgramState) => void) | null = null;
  private configPath: string;
  
  constructor(config: ProgramConfig, configPath: string) {
    super();
    this.id = config.id || uuidv4();
    this.name = config.name;
    this.command = config.command;
    this.screenName = config.screenName;
    this.maxChildDepth = config.maxChildDepth || 1;
    this.autoStart = config.autoStart || false;
    this.stopMethod = config.stopMethod || 'SIGHUP';
    this.configPath = configPath;
  }
  
  getState(): ProgramState {
    return {
      id: this.id,
      name: this.name,
      command: this.command,
      screenName: this.screenName,
      maxChildDepth: this.maxChildDepth,
      autoStart: this.autoStart,
      stopMethod: this.stopMethod,
      pid: this.pid,
      status: this.status,
      screenActive: this.screenActive,
      foregroundCommand: this.status === 'running' ? this.foregroundCommand : undefined
    };
  }
  
  setStatusChangeCallback(callback: (program: ProgramState) => void) {
    this.statusChangeCallback = callback;
  }
  
  private notifyStatusChange() {
    if (this.statusChangeCallback) {
      this.statusChangeCallback(this.getState());
    }
  }
  
  private updateStatus(newStatus: ProgramStatus) {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.notifyStatusChange();
    }
  }
  
  // ---------------------------------------------------------------------
  // tmux-backed session management (cross-platform: Linux, macOS, Windows
  // via Cygwin/MSYS tmux). "screen" in the public API/UI is kept for
  // backwards compatibility; a "screen" is a tmux session.
  // ---------------------------------------------------------------------

  private get tmux(): Tmux {
    return getTmux();
  }

  async startScreen(): Promise<boolean> {
    try {
      if (await this.tmux.hasSession(this.screenName)) {
        log.info(`Session ${this.screenName} already exists, using existing session`);
        this.setScreenActive(true);
        return true;
      }
      const created = await this.tmux.newSession(this.screenName);
      if (!created) {
        log.error(`Failed to start tmux session for ${this.name}`);
      }
      await this.checkScreenActive();
      return this.screenActive;
    } catch (error) {
      log.error(`Error starting session for ${this.name}:`, error);
      return false;
    }
  }

  /** Type a command line into the session and press Enter. */
  async sendCommandToScreen(command: string): Promise<boolean> {
    const ok = await this.tmux.sendKeys(this.screenName, command, true);
    if (!ok) log.error(`Failed to send command to session ${this.screenName}`);
    return ok;
  }

  /** Raw scrollback + visible screen of the session (undefined if no session). */
  async getOutput(lines = 1000): Promise<string | undefined> {
    return this.tmux.capturePane(this.screenName, lines);
  }

  async runInScreen(): Promise<boolean> {
    const screenStarted = await this.startScreen();
    if (!screenStarted) return false;
    return this.sendCommandToScreen(this.command);
  }

  async start(): Promise<boolean> {
    try {
      const existingPid = await this.findProcessPid();
      if (existingPid) {
        log.info(`Program ${this.name} is already running with PID ${existingPid}`);
        this.updateStatus('running');
        return true;
      }

      if (await this.runInScreen()) {
        // Give the shell a moment to launch the program before probing.
        await delay(500);
        await this.findProcessPid();
        this.updateStatus('running');
        return true;
      }
      return false;
    } catch (error) {
      log.error(`Error starting program ${this.name}:`, error);
      this.updateStatus('error');
      return false;
    }
  }

  async stop(): Promise<boolean> {
    try {
      log.info(`Stopping program ${this.name} (session: ${this.screenName}) using method: ${this.stopMethod}`);

      if (this.stopMethod === 'CTRL_C' || process.platform === 'win32') {
        // POSIX signals can't be delivered to processes living inside a
        // Cygwin pty from a native Node process, so on Windows every stop
        // method degrades to Ctrl+C in the session.
        return this.stopWithCtrlC();
      }

      if (!this.pid) {
        await this.findProcessPid();
        if (!this.pid) {
          log.info(`No PID found for ${this.name}, cannot stop with signal`);
          return this.screenActive ? this.stopWithCtrlC() : false;
        }
      }

      log.info(`Sending ${this.stopMethod} to process ${this.pid}`);
      process.kill(this.pid!, this.stopMethod);
      return this.waitForStop('signal');
    } catch (error) {
      log.error(`Error stopping program ${this.name}:`, error);
      return false;
    }
  }

  private async stopWithCtrlC(): Promise<boolean> {
    log.info(`Stopping ${this.name} by sending Ctrl+C to session ${this.screenName}`);
    if (!(await this.checkScreenActive())) {
      log.info(`Session ${this.screenName} is not active, cannot send Ctrl+C`);
      return false;
    }
    const sent = await this.tmux.sendCtrlC(this.screenName);
    log.info(`Sent Ctrl+C to session ${this.screenName}: ${sent ? 'success' : 'failed'}`);
    if (!sent) return false;
    return this.waitForStop('Ctrl+C');
  }

  /** Poll for up to ~3s until the foreground program has exited. */
  private async waitForStop(how: string): Promise<boolean> {
    for (let i = 0; i < 6; i++) {
      await delay(500);
      await this.findProcessPid();
      if (!this.pid) {
        log.info(`Program ${this.name} stopped successfully (${how})`);
        this.updateStatus('stopped');
        return true;
      }
    }
    log.info(`Program ${this.name} is still running after ${how}`);
    return false;
  }

  /** Kill the whole tmux session (and everything in it). */
  async terminate(): Promise<boolean> {
    try {
      log.info(`Terminating program ${this.name} (session: ${this.screenName})`);

      if (await this.checkScreenActive()) {
        const killed = await this.tmux.killSession(this.screenName);
        log.info(`kill-session ${this.screenName}: ${killed ? 'ok' : 'failed'}`);
      }

      // Belt and braces: if we know the shell PID and it outlived the session, kill its tree.
      if (this.pid && process.platform !== 'win32') {
        await new Promise<void>((resolve) => {
          treeKill(this.pid!, 'SIGKILL', (err: any) => {
            if (err) log.error(`Error killing process tree for ${this.name}:`, err);
            resolve();
          });
        });
      }

      this.pid = undefined;
      this.setScreenActive(false);
      this.updateStatus('stopped');

      await this.checkScreenActive();
      return !this.screenActive;
    } catch (error) {
      log.error(`Error terminating program ${this.name}:`, error);
      return false;
    }
  }

  /**
   * Determine whether a program (anything other than the session's idle
   * shell) is running in the foreground of the session. Sets this.pid to the
   * pane's shell PID while something is running, undefined otherwise.
   */
  async findProcessPid(): Promise<number | undefined> {
    if (!(await this.checkScreenActive())) {
      this.pid = undefined;
      this.updateStatus('stopped');
      return undefined;
    }

    const info = await this.tmux.paneInfo(this.screenName);
    if (!info || isIdleShell(info.currentCommand)) {
      this.pid = undefined;
      this.updateStatus('stopped');
      return undefined;
    }

    this.pid = info.pid;
    this.foregroundCommand = info.currentCommand;
    this.updateStatus('running');
    return this.pid;
  }

  async monitor(): Promise<void> {
    const prevPid = this.pid;
    const wasActive = this.screenActive;

    await this.checkScreenActive();
    if (!this.screenActive) {
      if (wasActive) log.info(`Session ${this.screenName} for program ${this.name} is no longer active`);
      this.pid = undefined;
      this.updateStatus('stopped');
      return;
    }

    await this.findProcessPid();
    if (prevPid && !this.pid) {
      log.info(`Program ${this.name} is no longer running (was PID: ${prevPid})`);
    }
  }

  async checkScreenActive(): Promise<boolean> {
    const active = await this.tmux.hasSession(this.screenName);
    this.setScreenActive(active);
    return active;
  }

  private setScreenActive(active: boolean) {
    if (this.screenActive !== active) {
      log.info(`Session ${this.screenName} active status changed: ${this.screenActive} -> ${active}`);
      this.screenActive = active;
      this.notifyStatusChange();
    }
  }

  toJSON(): ProgramConfig {
    return {
      id: this.id,
      name: this.name,
      command: this.command,
      screenName: this.screenName,
      maxChildDepth: this.maxChildDepth,
      autoStart: this.autoStart,
      stopMethod: this.stopMethod
    };
  }
  
  static fromJSON(json: ProgramConfig): Program {
    return new Program(json, '');
  }
}

export class ProgramManager {
  private programs: Map<string, Program> = new Map();
  private configPath: string;
  private statusChangeCallback: ((program: ProgramState) => void) | null = null;
  
  constructor(configPath: string) {
    this.configPath = path.resolve(configPath);
    log.info(this.configPath);

    this.ensureConfigDir();
  }
  
  private ensureConfigDir() {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  
  setStatusChangeCallback(callback: (program: ProgramState) => void) {
    this.statusChangeCallback = callback;
    // Set the callback for all existing programs
    for (const program of this.programs.values()) {
      program.setStatusChangeCallback(callback);
    }
  }
  
  async loadPrograms(): Promise<void> {
    try {
      log.info(`Loading programs from config: ${this.configPath}`);
      
      if (!fs.existsSync(this.configPath)) {
        // If config doesn't exist yet, create an empty one
        log.info(`Config file doesn't exist, creating empty config at: ${this.configPath}`);
        await this.savePrograms();
        return;
      }
      
      const data = await fs.promises.readFile(this.configPath, 'utf-8');
      log.info(`Read config data: ${data}`);
      
      try {
        const configs: ProgramConfig[] = JSON.parse(data);
        log.info(`Parsed ${configs.length} program configs`);
        
        this.programs.clear();
        for (const config of configs) {
          log.info(`Creating program from config: ${JSON.stringify(config)}`);
          const program = new Program(config, this.configPath);
          if (this.statusChangeCallback) {
            program.setStatusChangeCallback(this.statusChangeCallback);
          }
          this.programs.set(program.id, program);
        }
        
        log.info(`Loaded ${this.programs.size} programs from config`);
      } catch (parseError) {
        log.error('Error parsing config JSON:', parseError);
        throw parseError;
      }
    } catch (error) {
      log.error('Error loading programs:', error);
    }
  }
  
  async savePrograms(): Promise<void> {
    try {
      const configs = Array.from(this.programs.values()).map(p => p.toJSON());
      await fs.promises.writeFile(this.configPath, JSON.stringify(configs, null, 2));
      log.info(`Saved ${configs.length} programs to config`);
    } catch (error) {
      log.error('Error saving programs:', error);
    }
  }
  
  getPrograms(): Program[] {
    return Array.from(this.programs.values());
  }
  
  getProgramStates(): ProgramState[] {
    const states = this.getPrograms().map(p => p.getState());
    // log.info(`Getting program states, found ${states.length} programs:`, states);
    return states;
  }
  
  getProgram(id: string): Program | undefined {
    return this.programs.get(id);
  }
  
  addProgram(config: Omit<ProgramConfig, 'id'>): Program {
    const program = new Program({
      ...config,
      id: uuidv4()
    }, this.configPath);
    
    if (this.statusChangeCallback) {
      program.setStatusChangeCallback(this.statusChangeCallback);
    }
    
    this.programs.set(program.id, program);
    this.savePrograms();
    return program;
  }
  
  updateProgram(id: string, config: Partial<ProgramConfig>): Program | undefined {
    const program = this.programs.get(id);
    if (!program) return undefined;
    
    if (config.name !== undefined) program.name = config.name;
    if (config.command !== undefined) program.command = config.command;
    if (config.screenName !== undefined) program.screenName = config.screenName;
    if (config.maxChildDepth !== undefined) program.maxChildDepth = config.maxChildDepth;
    if (config.autoStart !== undefined) program.autoStart = config.autoStart;
    if (config.stopMethod !== undefined) program.stopMethod = config.stopMethod;
    
    this.savePrograms();
    return program;
  }
  
  deleteProgram(id: string): boolean {
    const result = this.programs.delete(id);
    if (result) {
      this.savePrograms();
    }
    return result;
  }
  
  async startAllAutoStart(): Promise<void> {
    for (const program of this.programs.values()) {
      if (program.autoStart) {
        await program.start();
      }
    }
  }
  
  async monitorAll(): Promise<void> {
    for (const program of this.programs.values()) {
      await program.monitor();
    }
  }
}
