import { Server, Socket } from 'socket.io';
import { spawn } from 'child_process';
import * as pty from 'node-pty';
import { v4 as uuidv4 } from 'uuid';

interface TerminalSession {
  id: string;
  screenName: string;
  ptyProcess?: any;
  socket: Socket;
  title: string;
  createdAt: Date;
  type: 'screen' | 'standalone';
}

export interface TerminalSessionInfo {
  id: string;
  screenName: string;
  title: string;
  createdAt: string;
  type: 'screen' | 'standalone';
}

export class TerminalServer {
  private io: Server;
  private sessions: Map<string, TerminalSession> = new Map();
  
  constructor(server: any) {
    this.io = new Server(server, {
      path: '/api/programs/terminal/socket.io',
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });
    
    console.log('TerminalServer initialized');
    this.setupSocketHandlers();
  }
  
  private setupSocketHandlers() {
    this.io.use((socket, next) => {
      const { username, password } = socket.handshake.auth;
      
      console.log(`Terminal auth attempt: ${username}`);
      
      // For simplicity, use the same credentials as the main WebSocket server
      const validUsername = process.env.ADMIN_USERNAME || 'admin';
      const validPassword = process.env.ADMIN_PASSWORD || 'admin';
      
      if (!username || !password || username !== validUsername || password !== validPassword) {
        console.error(`Terminal authentication failed for user: ${username}`);
        return next(new Error('Authentication failed'));
      }
      
      console.log(`Terminal authentication successful for user: ${username}`);
      next();
    });
    
    this.io.on('connection', (socket) => {
      console.log(`Terminal client connected: ${socket.id}`);
      
      // Send initial connection success message
      socket.emit('output', '\r\n\x1b[1;32mTerminal connected. Waiting for screen attachment...\x1b[0m\r\n');
      
      // Send list of active terminal sessions
      this.sendActiveTerminals(socket);
      
      socket.on('attach', (data: { screenName?: string, standalone?: boolean }) => {
        console.log(`Attach request received:`, data);
        
        if (data.standalone) {
          this.attachToStandaloneTerminal(socket);
        } else if (data.screenName) {
          this.attachToScreen(socket, data.screenName);
        } else {
          console.error('Invalid attach request: missing screenName or standalone flag');
          socket.emit('error', 'Invalid attach request: missing screenName or standalone flag');
        }
      });
      
      socket.on('list_terminals', () => {
        this.sendActiveTerminals(socket);
      });
      
      socket.on('input', (data: string) => {
        console.log(`Input received from client ${socket.id}: ${data.length} bytes`);
        this.handleInput(socket.id, data);
      });
      
      socket.on('disconnect', () => {
        this.handleDisconnect(socket.id);
        console.log(`Terminal client disconnected: ${socket.id}`);
      });
    });
  }
  
  private sendActiveTerminals(socket: Socket) {
    const activeTerminals: TerminalSessionInfo[] = Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      screenName: session.screenName,
      title: session.title,
      createdAt: session.createdAt.toISOString(),
      type: session.type
    }));
    
    console.log(`Sending ${activeTerminals.length} active terminals to client ${socket.id}`);
    socket.emit('active_terminals', activeTerminals);
  }
  
  private attachToStandaloneTerminal(socket: Socket) {
    try {
      console.log(`Creating standalone terminal for client: ${socket.id}`);
      const sessionId = uuidv4();
      
      // Create a direct shell
      const ptyProcess = pty.spawn('bash', [], {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: process.env.HOME,
        env: process.env as { [key: string]: string }
      });
      
      console.log(`Created pty process for standalone terminal`);
      
      const session: TerminalSession = {
        id: sessionId,
        screenName: 'standalone-' + sessionId.substring(0, 8),
        ptyProcess,
        socket,
        title: 'Standalone Terminal',
        createdAt: new Date(),
        type: 'standalone'
      };
      
      // Store the session with socket.id for easy lookup
      this.sessions.set(socket.id, session);
      
      // Handle output from pty and send to client
      ptyProcess.onData((data) => {
        console.log(`Sending ${data.length} bytes of output to client ${socket.id}`);
        socket.emit('output', data);
      });
      
      // Set up a nice prompt and welcome message
      ptyProcess.write(`echo "Welcome to the standalone terminal. Type 'exit' to close."\r`);
      ptyProcess.write(`PS1="\\[\\033[01;32m\\]\\u@\\h\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]\\$ "\r`);
      
      // Notify client of successful connection
      socket.emit('connected', { sessionId, standalone: true });
      console.log(`Client ${socket.id} attached to standalone terminal`);
      
      // Broadcast updated terminal list
      this.broadcastActiveTerminals();
      
    } catch (error) {
      console.error(`Error creating standalone terminal: ${error}`);
      socket.emit('error', `Failed to create standalone terminal: ${error}`);
    }
  }
  
  private attachToScreen(socket: Socket, screenName: string) {
    try {
      console.log(`Attempting to attach to screen: ${screenName}`);
      const sessionId = uuidv4();
      
      // Create a direct shell if screen doesn't exist
      const ptyProcess = pty.spawn('bash', [], {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: process.env.HOME,
        env: process.env as { [key: string]: string }
      });
      
      console.log(`Created pty process for terminal`);
      
      const session: TerminalSession = {
        id: sessionId,
        screenName,
        ptyProcess,
        socket,
        title: `Screen: ${screenName}`,
        createdAt: new Date(),
        type: 'screen'
      };
      
      // Store the session with socket.id for easy lookup
      this.sessions.set(socket.id, session);
      
      // Handle output from pty and send to client
      ptyProcess.onData((data) => {
        console.log(`Sending ${data.length} bytes of output to client ${socket.id}`);
        socket.emit('output', data);
      });
      
      // Try to attach to screen if it exists
      ptyProcess.write(`screen -x ${screenName} || echo "Screen session '${screenName}' not found. Starting a new shell."\r`);
      
      // Notify client of successful connection
      socket.emit('connected', { sessionId, screenName });
      console.log(`Client ${socket.id} attached to terminal for screen ${screenName}`);
      
      // Broadcast updated terminal list
      this.broadcastActiveTerminals();
      
    } catch (error) {
      console.error(`Error attaching to screen: ${error}`);
      socket.emit('error', `Failed to attach to screen: ${error}`);
    }
  }
  
  private handleInput(socketId: string, data: string) {
    const session = this.sessions.get(socketId);
    if (session && session.ptyProcess) {
      console.log(`Writing ${data.length} bytes to pty for client ${socketId}`);
      session.ptyProcess.write(data);
    } else {
      console.error(`No session found for socket ID: ${socketId}`);
    }
  }
  
  private handleDisconnect(socketId: string) {
    const session = this.sessions.get(socketId);
    if (session) {
      console.log(`Cleaning up session for client ${socketId}`);
      if (session.ptyProcess) {
        // Don't kill the screen session, just disconnect the pty
        session.ptyProcess.kill();
        console.log(`Killed pty process for client ${socketId}`);
      }
      this.sessions.delete(socketId);
      
      // Broadcast updated terminal list to all clients
      setTimeout(() => {
        this.broadcastActiveTerminals();
      }, 100);
    }
  }
  
  private broadcastActiveTerminals() {
    const activeTerminals: TerminalSessionInfo[] = Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      screenName: session.screenName,
      title: session.title,
      createdAt: session.createdAt.toISOString(),
      type: session.type
    }));
    
    console.log(`Broadcasting ${activeTerminals.length} active terminals to all clients`);
    this.io.emit('active_terminals', activeTerminals);
  }
  
  shutdown() {
    console.log('Shutting down TerminalServer');
    // Clean up all sessions
    for (const session of this.sessions.values()) {
      if (session.ptyProcess) {
        session.ptyProcess.kill();
      }
    }
    this.sessions.clear();
  }
}
