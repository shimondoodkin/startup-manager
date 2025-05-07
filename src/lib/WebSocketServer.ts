import { Server, Namespace } from 'socket.io';
import { Program, ProgramManager, ProgramState } from './Program';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

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

interface AuthToken {
  token: string;
  socketId: string;
  createdAt: Date;
  expiresAt: Date;
}

export class WebSocketServer {
  private io: Namespace;
  private programManager: ProgramManager;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private authCredentials = {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'password'
  };
  private authTokens: AuthToken[] = [];
  
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
    
    // Clean expired tokens every minute
    setInterval(() => this.cleanExpiredTokens(), 60000);
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
      
      socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        // Remove all tokens for this socket when it disconnects
        this.authTokens = this.authTokens.filter(t => t.socketId !== socket.id);
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
      
      case 'generateTerminalToken':
        return this.generateAuthToken(socketId);
        
      case 'validateTerminalToken':
        return { valid: this.validateAuthToken(params.token) };
        
      default:
        throw new Error(`Unknown method: ${method}`);
    }
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
  
  // Token management methods
  private generateAuthToken(socketId: string): { token: string, expiresIn: number } {
    // Generate a random token
    const token = uuidv4();
    const now = new Date();
    // Token expires in 5 minutes
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
    
    // Store the token
    this.authTokens.push({
      token,
      socketId,
      createdAt: now,
      expiresAt
    });
    
    console.log(`Generated new auth token for socket ${socketId}, expires at ${expiresAt.toISOString()}`);
    
    // Return token and expiration time (in seconds)
    return { 
      token, 
      expiresIn: Math.floor((expiresAt.getTime() - now.getTime()) / 1000)
    };
  }
  
  public validateAuthToken(token: string): boolean {
    const now = new Date();
    const authToken = this.authTokens.find(t => t.token === token);
    
    if (!authToken) {
      console.log(`Token validation failed: token not found`);
      return false;
    }
    
    if (authToken.expiresAt < now) {
      console.log(`Token validation failed: token expired at ${authToken.expiresAt.toISOString()}`);
      return false;
    }
    
    console.log(`Token validated successfully for socket ${authToken.socketId}`);
    return true;
  }
  
  private cleanExpiredTokens() {
    const now = new Date();
    const initialCount = this.authTokens.length;
    
    this.authTokens = this.authTokens.filter(token => token.expiresAt > now);
    
    const removedCount = initialCount - this.authTokens.length;
    if (removedCount > 0) {
      console.log(`Cleaned up ${removedCount} expired auth tokens`);
    }
  }
}
