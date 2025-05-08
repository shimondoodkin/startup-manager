import { Socket, Namespace } from 'socket.io';
import * as pty from 'node-pty';
import { v4 as uuidv4 } from 'uuid';
import { WebSocketServer } from './WebSocketServer';

interface TerminalInstance {
  id: string;
  ptyProcess: pty.IPty;
  connections: Map<string, Socket>;
  createdAt: Date;
  initialCommand: string[];
  buffer: string[];
  screenName?: string;
  programName?: string;
}


export interface TerminalSessionInfo {
  id: string;
  pid: number;
  screenName?: string;

  createdAt: string;
  connectionCount?: number; // Number of active connections to this PTY
}

export class TerminalServer {
  // List all terminals (for RPC)
  public listTerminals() {
    // Return minimal info about each terminal
    return Array.from(this.terminals.values()).map(term => ({
      id: term.id,
      pid: term.ptyProcess.pid,
      screenName: term.screenName || '',

      createdAt: term.createdAt.toISOString(),
      connectionCount: term.connections.size
    }));
  }

  // Create a new terminal (for RPC)
  public createTerminal({ screenName, shell }: { screenName?: string, shell?: string }) {
    const terminalId = uuidv4();
    let command: string[];
    if (screenName) {
      command = ['screen', '-S', screenName];
    } else if (shell) {
      command = [shell];
    } else {
      command = ['bash'];
    }
    const ptyProcess = pty.spawn(command[0], command.slice(1), {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: process.env.HOME,
      env: process.env as { [key: string]: string }
    });
    const buffer: string[] = [];
    const terminal: TerminalInstance = {
      id: terminalId,
      ptyProcess,
      connections: new Map(),
      createdAt: new Date(),
      initialCommand: command,
      buffer,
      screenName: screenName
    };
    this.terminals.set(terminalId, terminal);
    this.broadcastTerminalListChanged();
    // Handle PTY output
    ptyProcess.onData((data) => {
      buffer.push(data);
      if (buffer.length > 1000) buffer.splice(0, buffer.length - 1000);
      this.broadcastOutput(terminalId, data);
    });
    ptyProcess.onExit(() => {
      this.broadcastOutput(terminalId, '\r\n\x1b[1;31mTerminal process exited\x1b[0m\r\n');
      this.terminals.delete(terminalId);
      this.broadcastTerminalListChanged();
    });
    // Send welcome/init output
    if (!screenName) {
      ptyProcess.write('echo "Welcome to the terminal. Type \'exit\' to close."\r');
      ptyProcess.write('export PS1="$ "\r');
      ptyProcess.write('clear\r');
      ptyProcess.write('ls -la\r');
    }
    return {
      id: terminalId,
      pid: ptyProcess.pid,
      screenName: screenName || '',

      createdAt: new Date().toISOString(),
      connectionCount: 0
    };
  }


  // Get info about a specific terminal (for RPC)
  public getTerminalInfo(terminalId: string) {
    const term = this.terminals.get(terminalId);
    if (!term) return null;
    return {
      id: term.id,
      pid: term.ptyProcess.pid,
      screenName: term.screenName || '',
      createdAt: term.createdAt.toISOString(),
      connectionCount: term.connections.size
    };
  }
  private io: Namespace;
  private terminals: Map<string, TerminalInstance> = new Map();
  private socketToTerminalMap: Map<string, string> = new Map(); // Maps socket ID to terminal ID

  private webSocketServer: WebSocketServer | null = null;

  // Set the terminal server instance for terminal-related operations
  setWebSocketServer(webSocketServer: WebSocketServer) {
    this.webSocketServer = webSocketServer;
  }


  constructor(namespace: Namespace) {
    this.io = namespace;

    console.log('TerminalServer initialized');
    this.setupSocketHandlers();

    // Periodically check program name for all open PTYs every 3 seconds
    setInterval(() => {
      this.terminals.forEach((terminal) => {
        const pid = terminal.ptyProcess.pid;

        this.getForegroundProcessName(pid).then((name) => {
          if (name && name !== terminal.programName) {
            terminal.programName = name;
            // Emit to all connected clients
            terminal.connections.forEach((socket) => {
              socket.emit('programNameChanged', { terminalId: terminal.id, programName: name });
            });
          }
        });
      });
    }, 3000);
  }

  // Helper to get foreground process name for a PTY using ps
  private async getForegroundProcessName(pid: number): Promise<string | null> {
    const { exec } = require('child_process');
    return new Promise((resolve) => {
      exec(`ps -o comm= --sid ${pid} | head -n 1`, (err: any, stdout: string) => {
        if (err || !stdout) return resolve(null);
        resolve(stdout.trim());
      });
    });
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

        if (!this.webSocketServer) {
          console.error('Cannot validate token: WebSocketServer instance not available');
          return next(new Error('Server configuration error'));
        }

        const isValid = this.webSocketServer.validateAuthToken(token);

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

      socket.on('attach', (data: { id?: string, terminalId?: string, screenName?: string, shell?: string, clientId?: string }) => {
        // Accept both 'id' and 'terminalId' for compatibility
        if (data.id) {
          data.terminalId = data.id;
        }
        console.log(`Attach request received:`, data);
        this.createOrAttachTerminal(socket, data);
      });

      socket.on('input', (data: string) => {
        const terminalId = this.socketToTerminalMap.get(socket.id);
        if (terminalId) {
          this.handleInput(terminalId, data);
        } else {
          console.error(`No terminal found for socket ID: ${socket.id}`);
          socket.emit('error', 'No active terminal found');
        }
      });

      socket.on('close_terminal', () => {
        const terminalId = this.socketToTerminalMap.get(socket.id);
        if (terminalId) {
          this.closeTerminal(terminalId);
        } else {
          console.error(`No terminal found for socket ID: ${socket.id}`);
        }
      });

      socket.on('disconnect', () => {
        const terminalId = this.socketToTerminalMap.get(socket.id);
        if (terminalId) {
          this.removeClientFromTerminal(socket.id, terminalId);
        }
        this.socketToTerminalMap.delete(socket.id);
      });
    });
  }

  private createOrAttachTerminal(socket: Socket, data: { terminalId?: string, screenName?: string, shell?: string, clientId?: string }) {

    const clientId = data.clientId || socket.id;
    if (data.terminalId && this.terminals.has(data.terminalId)) {
      // Attach to existing terminal
      const terminal = this.terminals.get(data.terminalId)!;
      // Remove any previous connection for this client
      terminal.connections.forEach((existingSocket, existingClientId) => {
        if (existingClientId === clientId || existingSocket.id === socket.id) {
          this.socketToTerminalMap.delete(existingSocket.id);
          terminal.connections.delete(existingClientId);
        }
      });
      terminal.connections.set(clientId, socket);
      this.socketToTerminalMap.set(socket.id, terminal.id);
      // Send buffer to new client
      socket.emit('output', terminal.buffer.join(''));
      socket.emit('connected', {
        terminalId: terminal.id,
        screenName: terminal.screenName,
        connectionCount: terminal.connections.size
      });
      this.broadcastConnectionCountChange(terminal.id);
      return;
    }
    // Create new terminal
    const terminalId = uuidv4();
    let command: string[];
    let screenName: string | undefined;
    if (data.screenName) {
      command = ['screen', '-S', data.screenName];
      screenName = data.screenName;
    } else if (data.shell) {
      command = [data.shell];
    } else {
      command = ['bash'];
    }
    const ptyProcess = pty.spawn(command[0], command.slice(1), {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: process.env.HOME,
      env: process.env as { [key: string]: string }
    });
    const buffer: string[] = [];
    const terminal: TerminalInstance = {
      id: terminalId,
      ptyProcess,
      connections: new Map([[clientId, socket]]),
      createdAt: new Date(),
      initialCommand: command,
      buffer,
      screenName
    };
    // Store terminal
    this.terminals.set(terminalId, terminal);
    this.socketToTerminalMap.set(socket.id, terminalId);
    this.broadcastTerminalListChanged();
    // Handle PTY output
    ptyProcess.onData((data) => {
      buffer.push(data);
      // Optionally limit buffer size
      if (buffer.length > 1000) buffer.splice(0, buffer.length - 1000);
      this.broadcastOutput(terminalId, data);
    });
    // Handle PTY exit
    ptyProcess.onExit(() => {
      this.broadcastOutput(terminalId, '\r\n\x1b[1;31mTerminal process exited\x1b[0m\r\n');
      terminal.connections.forEach((s) => {
        s.emit('terminal_exited');
      });
      this.terminals.delete(terminalId);
      this.broadcastTerminalListChanged();
    });
    // Send welcome/init output
    if (!data.screenName) {
      ptyProcess.write('echo "Welcome to the terminal. Type \'exit\' to close."\r');
      ptyProcess.write('export PS1="$ "\r');
      ptyProcess.write('clear\r');
      ptyProcess.write('ls -la\r');
    }
    socket.emit('connected', {
      terminalId,
      screenName,
      connectionCount: 1
    });
  }

  private handleInput(terminalId: string, data: string) {
    const terminal = this.terminals.get(terminalId);
    if (terminal && terminal.ptyProcess) {
      terminal.ptyProcess.write(data);
    } else {
      console.error(`No terminal found for terminal ID: ${terminalId}`);
    }
  }

  private broadcastOutput(terminalId: string, data: string) {
    const terminal = this.terminals.get(terminalId);
    if (terminal) {
      terminal.connections.forEach((socket, clientId) => {
        try {
          socket.emit('output', data);
        } catch (error) {
          console.error(`Error sending output to client ${clientId}:`, error);
        }
      });
    }
  }

  private broadcastConnectionCountChange(terminalId: string) {
    const terminal = this.terminals.get(terminalId);
    if (terminal) {
      const count = terminal.connections.size;
      terminal.connections.forEach((socket, clientId) => {
        try {
          socket.emit('connectionCountChanged', { count });
        } catch (error) {
          console.error(`Error sending connection count to client ${clientId}:`, error);
        }
      });
    }
  }

  private removeClientFromTerminal(socketId: string, terminalId: string) {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) {
      return;
    }
    let clientIdToRemove: string | null = null;
    terminal.connections.forEach((socket, clientId) => {
      if (socket.id === socketId) {
        clientIdToRemove = clientId;
      }
    });
    if (clientIdToRemove) {
      terminal.connections.delete(clientIdToRemove);
      this.broadcastConnectionCountChange(terminalId);
    }
  }

  public closeTerminal(terminalId: string) {
    const terminal = this.terminals.get(terminalId);
    if (terminal) {
      terminal.ptyProcess.kill();
      terminal.connections.forEach((socket) => {
        socket.emit('terminal_closed');
      });
      this.terminals.delete(terminalId);
      this.broadcastTerminalListChanged();
    }
  }

  private broadcastTerminalListChanged() {
    this.io.emit('terminalListChanged');
  }

  shutdown() {
    this.terminals.forEach((terminal) => {
      terminal.ptyProcess.kill();
    });
    this.terminals.clear();
    this.io.disconnectSockets(true)
  }
}



