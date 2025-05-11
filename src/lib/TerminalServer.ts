import { Socket, Namespace } from 'socket.io';
import * as pty from 'node-pty';
import { WebSocketServer } from './WebSocketServer';

interface TerminalInstance {
  id: number;
  ptyProcess: pty.IPty;
  connections: Socket[];
  createdAt: Date;
  initialCommand: string[];
  buffer: string[];
  programName?: string;
  titleNote?: string; // <-- Added titleNote
}


export interface TerminalSessionInfo {
  id: number;
  pid: number;
  programName?: string;
  createdAt: Date;
  titleNote?: string; // <-- Added titleNote
}

export class TerminalServer {
  private terminals: TerminalInstance[] = [];
  private nextTerminalId: number = 1;

  private webSocketServer: WebSocketServer | null = null;

  // Set the terminal server instance for terminal-related operations
  setWebSocketServer(webSocketServer: WebSocketServer) {
    this.webSocketServer = webSocketServer;
  }

  constructor() {

    console.log('TerminalServer initialized');

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

  public setupSocketHandlers(socket: Socket) {

    console.log(`Terminal client connected: ${socket.id}`);

    // let attachedTerminals: { [id: string]: TerminalInstance } = {};

    // socket.emit('output', { id: null, data: '\r\n\x1b[1;32mTerminal connected. Waiting for screen attachment...\x1b[0m\r\n' });

    socket.on('attach', (data: { id: number }) => {
      const term = this.terminals.find((t) => t.id === data.id);
      if (!term) {
        socket.emit('error', { id: data?.id || null, data: 'Terminal ID missing or terminal not found' });
        return;
      }

      if (term.connections.indexOf(socket) !== -1) {
        socket.emit('error', { id: data?.id || null, data: 'Terminal already attached to this connection' });

        // attachedTerminals[data.id] = term;
        socket.emit('output', { id: term.id, data: term.buffer.join('') });
        socket.emit('connected', {
          id: term.id,
          pid: term.ptyProcess.pid,
          programName: term.programName,
          createdAt: term.createdAt,
        });

        return;
      }

      term.connections.push(socket);

      // attachedTerminals[data.id] = term;
      socket.emit('output', { id: term.id, data: term.buffer.join('') });
      socket.emit('connected', {
        id: term.id,
        pid: term.ptyProcess.pid,
        programName: term.programName,
        createdAt: term.createdAt,
      });
    });


    socket.on('detach', (data: { id: number }) => {
      const term = this.terminals.find((t) => t.id === data.id);
      if (!term) {
        socket.emit('error', { id: data?.id || null, data: 'Terminal ID missing or terminal not found' });
        return;
      }

      const index = term.connections.indexOf(socket);
      if (index === -1) {
        socket.emit('error', { id: data?.id || null, data: 'Terminal not attached to this connection' });
        return;
      }
      term.connections.splice(index, 1);

      socket.emit('disconnected', {
        id: term.id,
      });
      return;
    });

    socket.on('input', (data: { id: number, data: string }) => {
      const term = this.terminals.find((t) => t.id === data.id);

      if (!term) {
        socket.emit('error', { id: data?.id || null, data: 'Terminal not found' });
        return;
      }
      if (term.connections.indexOf(socket) === -1) {
        socket.emit('error', { id: data?.id || null, data: 'Terminal not attached in this connection' });
        return;
      }
      term.ptyProcess.write(data.data);
    });

    socket.on('refresh', (data: { id: number }) => {
      const term = this.terminals.find((t) => t.id === data.id);
      if (!term) {
        socket.emit('error', { id: data?.id || null, data: 'Terminal not found' });
        return;
      }
      if (term.connections.indexOf(socket) === -1) {
        socket.emit('error', { id: data?.id || null, data: 'Terminal not attached in this connection' });
        return;
      }
      socket.emit('refresh', { id: term.id, data: term.buffer.join('') });
    })

    return () => {
      // Clean up attached terminals for this socket
      for (const term of this.terminals) {
        const index = term.connections.indexOf(socket);
        if (index !== -1) {
          term.connections.splice(index, 1);
        }
      }
    }
  }


  // List all terminals (for RPC)
  public listTerminals(): TerminalSessionInfo[] {
    // Return minimal info about each terminal
    return this.terminals.map(term => ({
      id: term.id,
      pid: term.ptyProcess.pid,
      programName: term.programName,
      createdAt: term.createdAt,
      titleNote: term.titleNote || '',
    }));
  }

  // Create a new terminal (for RPC)
  public createTerminal({ shell, titleNote }: {  shell?: string, titleNote?: string }): TerminalSessionInfo {
    const terminalId = this.nextTerminalId++;
    let command: string[];
    if (shell) {
      // Parse shell command string into command and args using node's built-in shell-quote
      const shellQuote = require('shell-quote');
      // command = shellQuote.parse(shell, process.env);
      command = shellQuote.parse(shell); // env={}
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
      programName: '',
      titleNote: titleNote || '', 
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
      titleNote: terminal.titleNote || '', 
    };
  }

  private broadcastOutput(terminal: TerminalInstance, data: string) {
    if (terminal) {
      terminal.connections.forEach((socket) => {
        if (socket.connected) {
          try {
            socket.emit('output', { id: terminal.id, data });
          } catch (error) {
            console.error(`Error sending output to client ${socket.id}:`, error);
          }
        }
      });
    }
  }

  // Get info about a specific terminal (for RPC)
  public getTerminalInfo(terminalId: number): TerminalSessionInfo | null {
    const term = this.terminals.find(t => t.id === terminalId);
    if (!term) return null;
    return {
      id: term.id,
      pid: term.ptyProcess.pid,
      programName: term.programName || '',
      createdAt: term.createdAt,
    };
  }


  // private kickSocketFromTerminal(socketId: string, terminalId: string) {
  //   const terminal = this.terminals.find((t) => t.id === terminalId);
  //   if (!terminal) {
  //     throw new Error('Terminal not found');
  //   }
  //   const socket = terminal.connections.find((s) => s.id === socketId)
  //   if (!socket) {
  //     throw new Error('Socket not found');
  //   }
  //   socket.disconnect();
  //   // terminal.connections.splice(terminal.connections.indexOf(socket), 1);
  //   // this.socketToTerminalMap.delete(socket.id);
  // }

  public async closeTerminal(terminalId: number) {
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
    // await Promise.all(
    //   terminal.connections.map((socket) => {
    //     return new Promise<void>((resolve) => {
    //       socket.disconnect(true);
    //       resolve();
    //     });
    //   })
    // );

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
  }
}



