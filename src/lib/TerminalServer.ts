import { Server, Socket, Namespace } from 'socket.io';
import { spawn } from 'child_process';
import * as pty from 'node-pty';
import { v4 as uuidv4 } from 'uuid';

interface TerminalSession {
  id: string;
  screenName: string;
  ptyProcess?: pty.IPty;
  socket: Socket;
  title: string;
  createdAt: Date;
  type: 'screen' | 'standalone';
  exited: boolean;
}

export interface TerminalSessionInfo {
  id: string;
  screenName: string;
  title: string;
  createdAt: string;
  type: 'screen' | 'standalone';
}

export class TerminalServer {
  private io: Namespace;
  private sessions: Map<string, TerminalSession> = new Map();

  constructor(namespace: Namespace) {
    this.io = namespace;

    console.log('TerminalServer initialized');
    this.setupSocketHandlers();
  }

  private setupSocketHandlers() {
    this.io.use((socket, next) => {
      const { token } = socket.handshake.auth;

      console.log(`Terminal auth attempt with token: ${token ? token.substring(0, 8) + '...' : 'none'}`);

      if (!token) {
        console.error(`Terminal authentication failed: no token provided`);
        return next(new Error('Authentication failed: No token provided'));
      }

      // Validate token with WebSocketServer
      try {
        // Use a direct import of the WebSocketServer validation method
        // This assumes WebSocketServer is a singleton and accessible here
        const WebSocketServerInstance = (global as any).WebSocketServerInstance;

        if (!WebSocketServerInstance) {
          console.error('Cannot validate token: WebSocketServer instance not available');
          return next(new Error('Server configuration error'));
        }

        const isValid = WebSocketServerInstance.validateAuthToken(token);

        if (!isValid) {
          console.error(`Terminal authentication failed: invalid or expired token`);
          return next(new Error('Authentication failed: Invalid or expired token'));
        }

        console.log(`Terminal authentication successful with token`);
        next();
      } catch (error) {
        console.error(`Error validating token:`, error);
        return next(new Error('Authentication error'));
      }
    });

    this.io.on('connection', (socket) => {
      console.log(`Terminal client connected: ${socket.id}`);

      // Send initial connection success message
      socket.emit('output', '\r\n\x1b[1;32mTerminal connected with token authentication. Waiting for screen attachment...\x1b[0m\r\n');

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

      socket.on('input', (data: string) => {
        console.log(`Input received from client ${socket.id}: ${data.length} bytes`);
        this.handleInput(socket.id, data);
      });

      socket.on('close_terminal', () => {
        console.log(`Explicit terminal close request from client ${socket.id}`);
        this.handleDisconnect(socket.id);
      });

      socket.on('disconnect', () => {
        this.handleDisconnect(socket.id);
        console.log(`Terminal client disconnected: ${socket.id}`);
      });
    });
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
        type: 'standalone',
        exited: false,
      };
      ptyProcess.onExit(() => session.exited = true)

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
        type: 'screen',
        exited: false,
      };

      ptyProcess.onExit(() => session.exited = true)

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
    }
  }

  async shutdown() {
    console.log('Shutting down TerminalServer');

    // Clean up all sessions
    for (const session of this.sessions.values()) {
      if (session.ptyProcess) {
        try {
          let wait;
          if (!session.exited) {
            wait = new Promise<void>((resolve) => {
              if(session.ptyProcess){
                session.ptyProcess.onExit(() => resolve());
              }
              else{
                resolve();
              }
            });
          }
          session.ptyProcess.kill();
          if (wait) {
            await wait;
          }
        } catch (error) {
          console.error(`Error killing pty process for client ${session.socket.id}:`, error);
        }
      }
    }
    this.sessions.clear();
    this.io.disconnectSockets(true);
  }
}
