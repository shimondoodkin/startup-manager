import { Socket, Namespace } from 'socket.io';
import * as pty from 'node-pty';
import { v4 as uuidv4 } from 'uuid';
import { WebSocketServer } from './WebSocketServer';
import { error } from 'console';

interface TerminalInstance {
  id: string;
  ptyProcess: pty.IPty;
  connections: Socket[];
  createdAt: Date;
  initialCommand: string[];
  buffer: string[];
  screenName?: string;
  programName?: string;
}


export interface TerminalSessionInfo {
  id: string;
  pid: number;
  programName?: string;
  createdAt: Date;
  //  connectionCount?: number; // Number of active connections to this PTY
}

export class TerminalServer {
  private io: Namespace;
  private terminals: TerminalInstance[] = [];
  // private socketToTerminalMap: Map<string, string> = new Map(); // Maps socket ID to terminal ID

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

      let terminalRef = { terminal: null as TerminalInstance | null };

      // Send initial connection success message
      socket.emit('output', '\r\n\x1b[1;32mTerminal connected with token authentication. Waiting for screen attachment...\x1b[0m\r\n');

      socket.on('attach', (data: { id?: string }) => {
        // Accept both 'id' and 'terminalId' for compatibility
        console.log(`Attach request received:`, data);
        try {
          this.AttachTerminal(socket, data, terminalRef);
        }
        catch (e: any) {
          socket.emit("error", e?.message || 'no error message')
          console.log(e?.stack)
        }
      });

      socket.on('input', (data: string) => {
        try {
          if (!terminalRef?.terminal) {
            throw new Error("terminal is not attached in this connection")
          }
          if (!terminalRef?.terminal?.ptyProcess) {
            throw new Error("no pty process in this terminal")
          }
          terminalRef.terminal.ptyProcess.write(data);
        }
        catch (e: any) {
          socket.emit("error", e?.message || 'no error message')
          console.log(e?.stack)
        }
      });

      socket.on('refresh', () => {
        try {
          if (!terminalRef?.terminal) {
            throw new Error("terminal is not attached in this connection")
          }
          // Send buffer to new client
          socket.emit('size', { cols: terminalRef.terminal.ptyProcess.cols, rows: terminalRef.terminal.ptyProcess.rows });
          socket.emit('refresh', terminalRef.terminal.buffer.join(''));
        }
        catch (e: any) {
          socket.emit("error", e?.message || 'no error message')
          console.log(e?.stack)
        }
      })

      socket.on('disconnect', () => {
        terminalRef.terminal?.connections.splice(terminalRef.terminal.connections.indexOf(socket), 1);
      });
    });
  }


  // List all terminals (for RPC)
  public listTerminals(): TerminalSessionInfo[] {
    // Return minimal info about each terminal
    return this.terminals.map(term => ({
      id: term.id,
      pid: term.ptyProcess.pid,
      programName: term.programName || '',
      createdAt: term.createdAt,
      // connectionCount: term.connections.length
    } as TerminalSessionInfo));
  }

  // Create a new terminal (for RPC)
  public createTerminal({ screenName, shell }: { screenName?: string, shell?: string }): TerminalSessionInfo {
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
      connections: [],
      createdAt: new Date(),
      initialCommand: command,
      buffer,
      screenName: screenName
    };
    this.terminals.push(terminal);
    // Handle PTY output

    ptyProcess.onData((data) => {
      buffer.push(data);
      // Limit buffer size to prevent memory issues
      if (buffer.length > 1000) {
        buffer.splice(0, buffer.length - 1000);
      }
      this.broadcastOutput(terminal, data);
    });

    ptyProcess.onExit(() => {
      this.broadcastOutput(terminal, '\r\n\x1b[1;31mTerminal process exited\x1b[0m\r\n');
      this.terminals.splice(this.terminals.findIndex(t => t.id === terminalId), 1);
      terminal.connections.map((socket) => {
        socket.emit('terminal_exited');
      });
      this.broadcastTerminalListChanged();
    });

    this.broadcastTerminalListChanged();

    // Send welcome/init output
    // if (!screenName) {
    //   ptyProcess.write('echo "Welcome to the terminal. Type \'exit\' to close."\r');
    //   ptyProcess.write('export PS1="$ "\r');
    //   ptyProcess.write('clear\r');
    //   ptyProcess.write('ls -la\r');
    // }

    return {
      id: terminal.id,
      pid: terminal.ptyProcess.pid,
      programName: terminal.programName || '',
      createdAt: terminal.createdAt,
      // connectionCount: 0
    };
  }

  private broadcastOutput(terminal: TerminalInstance, data: string) {
    if (terminal) {
      terminal.connections.forEach((socket) => {
        if (socket.connected) {
          try {
            socket.emit('output', data);
          } catch (error) {
            console.error(`Error sending output to client ${socket.id}:`, error);
          }
        }
      });
    }
  }

  // Get info about a specific terminal (for RPC)
  public getTerminalInfo(terminalId: string): TerminalSessionInfo | null {
    const term = this.terminals.find(t => t.id === terminalId);
    if (!term) return null;
    return {
      id: term.id,
      pid: term.ptyProcess.pid,
      programName: term.programName || '',
      createdAt: term.createdAt,
      // connectionCount: term.connections.length
    };
  }

  private AttachTerminal(socket: Socket, data: { id?: string }, terminalRef: { terminal: TerminalInstance | null }) {

    if (!(data.id && this.terminals.findIndex((t) => t.id === data.id) !== -1)) {
      throw new Error("Terminal ID missing or terminal not found");
    }

    const terminal = this.terminals.find((t) => t.id === data.id)!;

    terminal.connections.forEach((participating_socket) => {
      if (participating_socket.id === socket.id) {
        throw new Error("Socket already connected to terminal");
      }
    });

    terminal.connections.push(socket);

    // this.socketToTerminalMap.set(socket.id, terminal.id);

    // Send buffer to new client
    socket.emit('output', terminal.buffer.join(''));
    socket.emit('connected', {
      id: terminal.id,
      pid: terminal.ptyProcess.pid,
      programName: terminal.programName,
      createdAt: terminal.createdAt,
      // connectionCount: terminal.connections.length
    } as TerminalSessionInfo);
    terminalRef.terminal = terminal;
    return;
  }

  private kickSocketFromTerminal(socketId: string, terminalId: string) {
    const terminal = this.terminals.find((t) => t.id === terminalId);
    if (!terminal) {
      throw new Error('Terminal not found');
    }
    const socket = terminal.connections.find((s) => s.id === socketId)
    if (!socket) {
      throw new Error('Socket not found');
    }
    socket.disconnect();
    // terminal.connections.splice(terminal.connections.indexOf(socket), 1);
    // this.socketToTerminalMap.delete(socket.id);
  }

  public async closeTerminal(terminalId: string) {
    const terminal = this.terminals.find(t => t.id === terminalId);
    if (!terminal) {
      throw new Error("Terminal not found");
    }

    terminal.ptyProcess.kill();

    // Emit terminal_closed event to all connections
    terminal.connections.forEach((socket) => {
      socket.emit('terminal_closed');
    });

    // Properly await all socket disconnections
    await Promise.all(
      terminal.connections.map((socket) => {
        return new Promise<void>((resolve) => {
          socket.disconnect(true);
          resolve();
        });
      })
    );

    terminal.connections.length = 0;
    this.terminals.splice(this.terminals.findIndex(t => t.id === terminalId), 1);
    this.broadcastTerminalListChanged();
  }

  private broadcastTerminalListChanged() {
    this.webSocketServer?.broadcastTerminalsChanged();
  }

  async shutdown() {
    // Wait for all terminals to be closed properly
    await Promise.all(
      this.terminals.map(async (terminal) => {
        await this.closeTerminal(terminal.id);
      })
    );

    // Disconnect all sockets after terminals are closed
    this.io.disconnectSockets(true);
  }
}



