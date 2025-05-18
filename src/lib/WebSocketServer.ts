import { Server, Namespace, Socket } from 'socket.io';
import { Program, ProgramManager, ProgramState } from './Program';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { TerminalServer } from './TerminalServer';
import logger, { logWithIP } from './logger';
import config from './config';

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
  
  // Track connection attempts for rate limiting
  private connectionAttempts: Record<string, {count: number, lastAttempt: number}> = {};
  
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
      try {
        // Get client IP address
        const ip = this.getClientIP(socket);
        
        // Implement rate limiting for authentication attempts
        if (!this.checkRateLimit(ip)) {
          logWithIP('warn', 'Rate limit exceeded for authentication attempts', ip, {
            socketId: socket.id
          });
          return next(new Error('Too many authentication attempts'));
        }
        
        const { username, password } = socket.handshake.auth;
        
        if (!username || !password || 
            username !== this.authCredentials.username || 
            password !== this.authCredentials.password) {
          logWithIP('warn', 'Authentication failed', ip, {
            socketId: socket.id,
            username
          });
          return next(new Error('Authentication failed'));
        }
        
        // Log successful authentication
        logWithIP('info', 'Authentication successful', ip, {
          socketId: socket.id,
          username
        });
        
        next();
      } catch (error) {
        logger.error('Error in socket middleware', { error });
        next(new Error('Server error'));
      }
    });
    
    this.io.on('connection', (socket) => {
      const ip = this.getClientIP(socket);
      logWithIP('info', 'Client connected', ip, { socketId: socket.id });
      
      // Send initial program list to the client upon successful connection
      const programStates = this.programManager.getProgramStates();
      if (process.env.NODE_ENV !== 'production') logWithIP('debug', 'Sending initial program list to client', this.getClientIP(socket), {
        socketId: socket.id,
        programCount: programStates.length
      });
      
      socket.emit('notification', {
        method: 'initialProgramList',
        params: programStates
      });
      
      socket.on('rpc', async (request: RPCRequest, callback) => {
        const ip = this.getClientIP(socket);
        try {
          if (process.env.NODE_ENV !== 'production') logWithIP('debug', `Received RPC request`, ip, {
            socketId: socket.id,
            method: request.method,
            requestId: request.id
          });
          
          const result = await this.handleRPC(request, socket.id);
          
          if (process.env.NODE_ENV !== 'production') logWithIP('debug', `Sending RPC response`, ip, {
            socketId: socket.id,
            method: request.method,
            requestId: request.id,
            success: true
          });
          
          callback({ id: request.id, result });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logWithIP('error', `Error handling RPC`, ip, {
            socketId: socket.id,
            method: request.method,
            requestId: request.id,
            error: errorMessage
          });
          
          callback({ id: request.id, error: errorMessage });
        }
      });

      const onDisconnect: ()=>void = this.terminalServer?.setupSocketHandlers(socket) || (() => {});
      socket.on('disconnect', () => {
        const ip = this.getClientIP(socket);
        logWithIP('info', 'Client disconnected', ip, { socketId: socket.id });
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
        const terminalInfo = this.terminalServer.createTerminal(params);
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
        logger.info(`Closing terminal`, { terminalId: params.id });
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
  
  public async initialize() {
    await this.programManager.loadPrograms();
    await this.programManager.startAllAutoStart();
    return;
  }
  
  // Set the terminal server instance for terminal-related operations
  public setTerminalServer(terminalServer: TerminalServer) {
    this.terminalServer = terminalServer;
  }
  
  // Utility method to get client IP address
  private getClientIP(socket: Socket): string {
    // Try to get IP from headers if behind proxy
    const forwardedFor = socket.handshake.headers['x-forwarded-for'];
    if (forwardedFor) {
      return Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor.split(',')[0];
    }
    
    // Fall back to socket remote address
    return socket.handshake.address || 'unknown';
  }
  
  // Rate limiting for authentication attempts (WebSocket logins only)
  private checkRateLimit(ip: string): boolean {
    const now = Date.now();
    // Use configuration values for rate limiting
    const windowMs = config.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000;
    const maxAttempts = config.RATE_LIMIT_MAX_REQUESTS;
    
    // Initialize tracking for this IP if not exists
    if (!this.connectionAttempts[ip]) {
      this.connectionAttempts[ip] = { count: 1, lastAttempt: now };
      return true;
    }
    
    const attempt = this.connectionAttempts[ip];
    
    // Reset counter if outside window
    if (now - attempt.lastAttempt > windowMs) {
      attempt.count = 1;
      attempt.lastAttempt = now;
      return true;
    }
    
    // Increment counter and check limit
    attempt.count++;
    attempt.lastAttempt = now;
    
    // Clean up old entries periodically
    if (Object.keys(this.connectionAttempts).length > 1000) {
      this.cleanupConnectionAttempts(now - windowMs);
    }
    
    return attempt.count <= maxAttempts;
  }
  
  // Clean up old rate limiting entries
  private cleanupConnectionAttempts(olderThan: number) {
    for (const ip in this.connectionAttempts) {
      if (this.connectionAttempts[ip].lastAttempt < olderThan) {
        delete this.connectionAttempts[ip];
      }
    }
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
  
  public shutdown() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    // Disconnect all sockets in this namespace
    this.io.disconnectSockets(true);
    
    logger.info('WebSocket server shutdown complete');
  }
  
}
