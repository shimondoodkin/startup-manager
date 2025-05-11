import { Server, Namespace } from 'socket.io';
import { Program, ProgramManager, ProgramState } from './Program';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { TerminalServer } from './TerminalServer';

// Define the RPC message types
export interface RPCRequest {
  id: string;
  method: string;
  params: any;
}

export interface RPCResponse {
  id: string;
  result?: any;
  error?: string;
}

export interface RPCNotification {
  method: string;
  params: any;
}
export class WebSocketServer {
  private io: Namespace;
  private programManager: ProgramManager;
  private terminalServer: TerminalServer | null = null;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private authCredentials = {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'password'
  };
  
  constructor(namespace: Namespace) {
    this.io = namespace;
    
    const configPath = process.env.CONFIG_PATH || path.join(os.homedir(), '.startup-manager', 'programs.json');
    this.programManager = new ProgramManager(configPath);
    
    // Set up status change callback
    this.programManager.setStatusChangeCallback((program) => {
      this.broadcastStatusChange(program);
    });
    
    this.setupSocketHandlers();
    this.startMonitoring();
    
  }
  
  private setupSocketHandlers() {
    this.io.use((socket, next) => {
      const { username, password } = socket.handshake.auth;
      
      if (!username || !password || 
          username !== this.authCredentials.username || 
          password !== this.authCredentials.password) {
        return next(new Error('Authentication failed'));
      }
      
      next();
    });
    
    this.io.on('connection', (socket) => {
      console.log(`Client connected: ${socket.id}`);
      
      // Send initial program list to the client upon successful connection
      const programStates = this.programManager.getProgramStates();
      console.log(`Sending initial program list to client ${socket.id}:`, programStates);
      
      socket.emit('notification', {
        method: 'initialProgramList',
        params: programStates
      });
      
      socket.on('rpc', async (request: RPCRequest, callback) => {
        try {
          console.log(`Received RPC request from ${socket.id}:`, request.method, request.params);
          const result = await this.handleRPC(request, socket.id);
          console.log(`Sending RPC response to ${socket.id}:`, request.method, result);
          callback({ id: request.id, result });
        } catch (error) {
          console.error(`Error handling RPC ${request.method}:`, error);
          callback({ id: request.id, error: error instanceof Error ? error.message : 'Unknown error' });
        }
      });

      const onDisconnect: ()=>void = this.terminalServer?.setupSocketHandlers(socket) || (() => {});
      socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        onDisconnect();
      });

    });
  }
  
  private async handleRPC(request: RPCRequest, socketId: string): Promise<any> {
    const { method, params } = request;
    
    switch (method) {
      case 'listPrograms':
        return this.programManager.getProgramStates();
        
      case 'addProgram':
        return this.programManager.addProgram(params).getState();
        
      case 'editProgram':
        const { id, ...config } = params;
        const updated = this.programManager.updateProgram(id, config);
        if (!updated) throw new Error(`Program with id ${id} not found`);
        return updated.getState();
        
      case 'deleteProgram':
        const deleted = this.programManager.deleteProgram(params.id);
        if (!deleted) throw new Error(`Program with id ${params.id} not found`);
        return { success: true };
        
      case 'startProgram':
        const startProgram = this.programManager.getProgram(params.id);
        if (!startProgram) throw new Error(`Program with id ${params.id} not found`);
        await startProgram.start();
        return startProgram.getState();
        
      case 'stopProgram':
        const stopProgram = this.programManager.getProgram(params.id);
        if (!stopProgram) throw new Error(`Program with id ${params.id} not found`);
        await stopProgram.stop();
        return stopProgram.getState();
        
      case 'terminateProgram':
        const termProgram = this.programManager.getProgram(params.id);
        if (!termProgram) throw new Error(`Program with id ${params.id} not found`);
        await termProgram.terminate();
        return termProgram.getState();
        
      case 'getProgramStatus':
        const program = this.programManager.getProgram(params.id);
        if (!program) throw new Error(`Program with id ${params.id} not found`);
        await program.monitor();
        return program.getState();
      
      case 'startScreen':
        const screenProgram = this.programManager.getProgram(params.id);
        if (!screenProgram) throw new Error(`Program with id ${params.id} not found`);
        const success = await screenProgram.startScreen();
        return { success, state: screenProgram.getState() };
        
      case 'sendCommandToScreen':
        const cmdProgram = this.programManager.getProgram(params.id);
        if (!cmdProgram) throw new Error(`Program with id ${params.id} not found`);
        const sent = await cmdProgram.sendCommandToScreen(params.command);
        return { success: sent, state: cmdProgram.getState() };

      case 'listTerminals':
        if (!this.terminalServer) {
          throw new Error('Terminal server not initialized');
        }
        return this.terminalServer.listTerminals();
        
      case 'createTerminal':
        if (!this.terminalServer) {
          throw new Error('Terminal server not initialized');
        }
        // Create a terminal with the provided options (screenName or shell)
        const { shell } = params;
        const terminalInfo = this.terminalServer.createTerminal({ shell });
        return terminalInfo;
        
      case 'getTerminalInfo':
        if (!this.terminalServer) {
          throw new Error('Terminal server not initialized');
        }
        // Get information about a specific terminal
        const terminalId = params.id;
        const info = this.terminalServer.getTerminalInfo(terminalId);
        if (!info) {
          throw new Error(`Terminal with ID ${terminalId} not found`);
        }
        return info;

      case 'closeTerminal':
        if (!this.terminalServer) {
          throw new Error('Terminal server not initialized');
        }
        // Close the specified terminal
        console.log(`RPC: Closing terminal ${params.id}`);
        this.terminalServer.closeTerminal(params.id);
        return { success: true };
        
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }
  
  public broadcastTerminalsChanged() {
    this.io.emit('terminalsChanged');
  }
  
  private broadcastStatusChange(program: ProgramState) {
    const notification: RPCNotification = {
      method: 'programStatusChanged',
      params: program
    };
    
    this.io.emit('notification', notification);
  }
  
  async initialize() {
    await this.programManager.loadPrograms();
    await this.programManager.startAllAutoStart();
  }
  
  // Set the terminal server instance for terminal-related operations
  setTerminalServer(terminalServer: TerminalServer) {
    this.terminalServer = terminalServer;
  }
  
  private startMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    
    // Check program status more frequently (every 3 seconds instead of 10)
    this.monitoringInterval = setInterval(async () => {
      await this.programManager.monitorAll();
      
      // Broadcast the current program list to all clients to ensure UI is in sync
      const programStates = this.programManager.getProgramStates();
      this.io.emit('notification', {
        method: 'programListUpdated',
        params: programStates
      });
    }, 3000);
  }
  
  shutdown() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    // Disconnect all sockets in this namespace
    this.io.disconnectSockets(true);
  }
  
}
