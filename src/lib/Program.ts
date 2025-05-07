import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import treeKill from 'tree-kill';
import { EventEmitter } from 'events';

export type StopMethod = 'SIGINT' | 'SIGHUP' | 'CTRL_C';

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
      screenActive: this.screenActive
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
  
  async startScreen(): Promise<boolean> {
    return new Promise((resolve) => {
      // First check if screen is already active
      exec(`screen -list | grep "${this.screenName}"`, async (error, stdout) => {
        if (!error && stdout.includes(this.screenName)) {
          // Screen already exists, mark as active and resolve
          console.log(`Screen ${this.screenName} already exists, using existing session`);
          this.screenActive = true;
          resolve(true);
          return;
        }
        
        // Screen doesn't exist, create a new one
        exec(`screen -dmS ${this.screenName}`, async (error) => {
          if (error) {
            console.error(`Failed to start screen for ${this.name}:`, error);
            resolve(false);
            return;
          }
          
          await this.checkScreenActive();
          resolve(this.screenActive);
        });
      });
    });
  }
  
  async sendCommandToScreen(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      exec(`screen -S ${this.screenName} -X stuff "${command}\n"`, (error) => {
        if (error) {
          console.error(`Failed to send command to screen ${this.screenName}:`, error);
          resolve(false);
          return;
        }
        resolve(true);
      });
    });
  }
  
  async runInScreen(): Promise<boolean> {
    const screenStarted = await this.startScreen();
    if (!screenStarted) return false;
    
    return this.sendCommandToScreen(this.command);
  }
  
  async start(): Promise<boolean> {
    try {
      // First check if screen already exists and has our process running
      const existingPid = await this.findProcessPid();
      if (existingPid) {
        console.log(`Program ${this.name} is already running with PID ${existingPid}`);
        this.updateStatus('running');
        return true;
      }
      
      // Start the program in a screen
      if (await this.runInScreen()) {
        // We need to get the PID of the actual process running in the screen
        await this.findProcessPid();
        this.updateStatus('running');
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Error starting program ${this.name}:`, error);
      this.updateStatus('error');
      return false;
    }
  }
  
  async stop(): Promise<boolean> {
    try {
      console.log(`Stopping program ${this.name} (screen: ${this.screenName}) using method: ${this.stopMethod}`);
      
      // Check if we have a PID for signal methods
      if (this.stopMethod !== 'CTRL_C' && !this.pid) {
        console.log(`No PID found for ${this.name}, trying to find it`);
        await this.findProcessPid();
        
        if (!this.pid) {
          console.log(`Still no PID found for ${this.name}, cannot stop with signal`);
          
          // If we can't find PID but screen is active, try Ctrl+C as fallback
          if (this.screenActive) {
            return this.stopWithCtrlC();
          }
          
          return false;
        }
      }
      
      // Use the configured stop method
      if (this.stopMethod === 'SIGINT') {
        console.log(`Sending SIGINT to process ${this.pid}`);
        process.kill(this.pid!, 'SIGINT');
      } else if (this.stopMethod === 'SIGHUP') {
        console.log(`Sending SIGHUP to process ${this.pid}`);
        process.kill(this.pid!, 'SIGHUP');
      } else if (this.stopMethod === 'CTRL_C') {
        return this.stopWithCtrlC();
      }
      
      // Wait a moment for the process to terminate
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check if the process is still running
      await this.findProcessPid();
      
      if (!this.pid) {
        console.log(`Program ${this.name} stopped successfully`);
        this.updateStatus('stopped');
        return true;
      } else {
        console.log(`Program ${this.name} is still running after stop attempt`);
        return false;
      }
    } catch (error) {
      console.error(`Error stopping program ${this.name}:`, error);
      return false;
    }
  }
  
  private async stopWithCtrlC(): Promise<boolean> {
    console.log(`Stopping ${this.name} by sending Ctrl+C to screen ${this.screenName}`);
    
    // Check if screen is active
    if (!this.screenActive) {
      await this.checkScreenActive();
      if (!this.screenActive) {
        console.log(`Screen ${this.screenName} is not active, cannot send Ctrl+C`);
        return false;
      }
    }
    
    // Send Ctrl+C to the screen session
    const ctrlCSent = await this.sendCommandToScreen('\x03');
    console.log(`Sent Ctrl+C to screen ${this.screenName}: ${ctrlCSent ? 'success' : 'failed'}`);
    
    // Wait a moment for the process to terminate
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check if the process is still running
    await this.findProcessPid();
    
    if (!this.pid) {
      console.log(`Program ${this.name} stopped successfully with Ctrl+C`);
      this.updateStatus('stopped');
      return true;
    } else {
      console.log(`Program ${this.name} is still running after Ctrl+C`);
      return false;
    }
  }
  
  async terminate(): Promise<boolean> {
    try {
      console.log(`Terminating program ${this.name} (screen: ${this.screenName})`);
      
      // First check if screen is active
      await this.checkScreenActive();
      
      // If screen is active, kill it regardless of process state
      if (this.screenActive) {
        console.log(`Killing screen session ${this.screenName}`);
        await new Promise<void>((resolve) => {
          exec(`screen -S ${this.screenName} -X quit`, (error) => {
            if (error) {
              console.error(`Failed to kill screen ${this.screenName}:`, error);
            } else {
              console.log(`Screen session ${this.screenName} killed successfully`);
            }
            resolve();
          });
        });
      }
      
      // Then try to kill the process if we have a PID
      if (this.pid) {
        console.log(`Killing process tree for PID ${this.pid}`);
        try {
          await new Promise<void>((resolve, reject) => {
            treeKill(this.pid!, 'SIGKILL', (err: any) => {
              if (err) {
                console.error(`Error killing process tree for ${this.name}:`, err);
              } else {
                console.log(`Process tree for ${this.name} killed successfully`);
              }
              resolve();
            });
          });
        } catch (error) {
          console.error(`Error in treeKill for ${this.name}:`, error);
        }
      }
      
      // Update status
      this.pid = undefined;
      this.screenActive = false;
      this.updateStatus('stopped');
      
      // Verify the screen is gone
      const screenStillExists = await this.checkScreenActive();
      
      // If screen still exists somehow, try one more aggressive approach
      if (screenStillExists) {
        console.log(`Screen session ${this.screenName} still exists after quit command, trying force kill`);
        await new Promise<void>((resolve) => {
          exec(`screen -wipe ${this.screenName} && screen -S ${this.screenName} -X quit`, (error) => {
            if (error) {
              console.error(`Failed to force kill screen ${this.screenName}:`, error);
            } else {
              console.log(`Screen session ${this.screenName} force killed successfully`);
            }
            resolve();
          });
        });
        
        // Check one more time
        this.screenActive = await this.checkScreenActive();
      }
      
      return !this.screenActive;
    } catch (error) {
      console.error(`Error terminating program ${this.name}:`, error);
      return false;
    }
  }
  
  async findProcessPid(): Promise<number | undefined> {
    return new Promise((resolve) => {
      // First check if the screen is active
      this.checkScreenActive().then(screenActive => {
        if (!screenActive) {
          this.pid = undefined;
          this.updateStatus('stopped');
          resolve(undefined);
          return;
        }
        
        // More robust approach to find processes in the screen session
        // Get all processes running in the screen session
        exec(`ps -o pid,cmd -t $(screen -ls | grep "${this.screenName}" | awk '{print $1}' | cut -d. -f1) | grep -v "SCREEN\\|ps\\|grep\\|awk\\|cut" | head -n 1 | awk '{print $1}'`, (err, stdout) => {
          if (err || !stdout.trim()) {
            // Try an alternative approach - find any process with our command
            const escapedCommand = this.command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            exec(`ps aux | grep "${escapedCommand}" | grep -v "grep\\|screen -S\\|SCREEN" | awk '{print $2}' | head -n 1`, (err2, stdout2) => {
              if (err2 || !stdout2.trim()) {
                // One more attempt - check if there's any process in the screen
                exec(`ps -o pid -t $(screen -ls | grep "${this.screenName}" | awk '{print $1}' | cut -d. -f1) | grep -v "PID" | head -n 1`, (err3, stdout3) => {
                  if (err3 || !stdout3.trim()) {
                    this.pid = undefined;
                    this.updateStatus('stopped');
                  } else {
                    this.pid = parseInt(stdout3.trim(), 10);
                    this.updateStatus('running');
                  }
                  resolve(this.pid);
                });
                return;
              }
              
              this.pid = parseInt(stdout2.trim(), 10);
              this.updateStatus('running');
              resolve(this.pid);
            });
            return;
          }
          
          this.pid = parseInt(stdout.trim(), 10);
          this.updateStatus('running');
          resolve(this.pid);
        });
      });
    });
  }
  
  async monitor(): Promise<void> {
    // First check if screen session still exists
    const prevStatus = this.status;
    const prevPid = this.pid;
    const prevScreenActive = this.screenActive;
    
    // Check if screen session exists
    await this.checkScreenActive();
    
    // If screen was active before but now isn't, log it and update status
    if (prevScreenActive && !this.screenActive) {
      console.log(`Screen session ${this.screenName} for program ${this.name} is no longer active`);
      this.pid = undefined;
      this.updateStatus('stopped');
      return;
    }
    
    // If screen is not active, program cannot be running
    if (!this.screenActive) {
      if (this.status !== 'stopped') {
        console.log(`Program ${this.name} is marked as stopped because screen ${this.screenName} is not active`);
        this.pid = undefined;
        this.updateStatus('stopped');
      }
      return;
    }
    
    // Screen is active, check for process
    await this.findProcessPid();
    
    // If we lost the PID or the status changed to stopped, log it
    if ((prevPid && !this.pid) || (prevStatus === 'running' && this.status === 'stopped')) {
      console.log(`Program ${this.name} is no longer running (was PID: ${prevPid})`);
    }
    
    // If we have a PID, double-check it's still valid
    if (this.pid) {
      try {
        // Check if the process is still running
        process.kill(this.pid, 0);
        this.updateStatus('running');
      } catch (error) {
        console.log(`Process ${this.pid} for ${this.name} is no longer running`);
        this.pid = undefined;
        this.updateStatus('stopped');
        
        // Check if screen session still exists but process is gone
        await this.checkScreenActive();
        if (this.screenActive) {
          // Screen exists but process is gone, try to find any new process
          await this.findProcessPid();
        }
      }
    }
  }
  
  async checkScreenActive(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      exec(`screen -list | grep "${this.screenName}"`, (error, stdout) => {
        const wasActive = this.screenActive;
        this.screenActive = !error && stdout.includes(this.screenName);
        
        if (wasActive !== this.screenActive) {
          console.log(`Screen session ${this.screenName} active status changed: ${wasActive} -> ${this.screenActive}`);
        }
        
        resolve(this.screenActive);
      });
    });
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
    console.log(this.configPath);

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
      console.log(`Loading programs from config: ${this.configPath}`);
      
      if (!fs.existsSync(this.configPath)) {
        // If config doesn't exist yet, create an empty one
        console.log(`Config file doesn't exist, creating empty config at: ${this.configPath}`);
        await this.savePrograms();
        return;
      }
      
      const data = await fs.promises.readFile(this.configPath, 'utf-8');
      console.log(`Read config data: ${data}`);
      
      try {
        const configs: ProgramConfig[] = JSON.parse(data);
        console.log(`Parsed ${configs.length} program configs`);
        
        this.programs.clear();
        for (const config of configs) {
          console.log(`Creating program from config: ${JSON.stringify(config)}`);
          const program = new Program(config, this.configPath);
          if (this.statusChangeCallback) {
            program.setStatusChangeCallback(this.statusChangeCallback);
          }
          this.programs.set(program.id, program);
        }
        
        console.log(`Loaded ${this.programs.size} programs from config`);
      } catch (parseError) {
        console.error('Error parsing config JSON:', parseError);
        throw parseError;
      }
    } catch (error) {
      console.error('Error loading programs:', error);
    }
  }
  
  async savePrograms(): Promise<void> {
    try {
      const configs = Array.from(this.programs.values()).map(p => p.toJSON());
      await fs.promises.writeFile(this.configPath, JSON.stringify(configs, null, 2));
      console.log(`Saved ${configs.length} programs to config`);
    } catch (error) {
      console.error('Error saving programs:', error);
    }
  }
  
  getPrograms(): Program[] {
    return Array.from(this.programs.values());
  }
  
  getProgramStates(): ProgramState[] {
    const states = this.getPrograms().map(p => p.getState());
    console.log(`Getting program states, found ${states.length} programs:`, states);
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
