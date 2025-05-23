import { io, Socket } from 'socket.io-client';
import { RPCRequest, RPCResponse, RPCNotification } from './WebSocketServer';
import { TerminalManagerClass } from './TerminalManager';

export interface WebSocketClientOptions {
  url: string;
  credentials: {
    username: string;
    password: string;
  };
  terminalManager: TerminalManagerClass
}

export class WebSocketClient {
  // Add event subscription methods for arbitrary events
  public on(event: string, handler: (...args: any[]) => void): void {
    if (this.socket) {
      this.socket.on(event, handler);
    }
  }

  public off(event: string, handler: (...args: any[]) => void): void {
    if (this.socket) {
      this.socket.off(event, handler);
    }
  }
  private socket: Socket | null = null;

  /**
   * Emit a custom event on the underlying socket.
   * @param event The event name to emit
   * @param args Arguments to send with the event
   */
  public emit(event: string, ...args: any[]): void {
    if (this.socket && this.connected) {
      this.socket.emit(event, ...args);
    } else {
      console.warn('WebSocketClient: Attempted to emit on disconnected socket:', event, args);
    }
  }
  public connected = false;
  private options: WebSocketClientOptions;
  private requestMap = new Map<string, { resolve: Function, reject: Function }>();
  private statusChangeHandler: ((program: any) => void) | null = null;
  private initialProgramListHandler: ((programs: any[]) => void) | null = null;
  private programListUpdatedHandler: ((programs: any[]) => void) | null = null;
  private connectedHandler: (() => void) | null = null;
  private disconnectedHandler: (() => void) | null = null;
  private errorHandler: ((error: any) => void) | null = null;
  private authCredentials: { username: string, password: string } | null = null;
  private terminalManager:TerminalManagerClass | null = null;

  constructor(options: WebSocketClientOptions) {
    this.options = options;
    this.terminalManager=options.terminalManager;
  }

  async connect(): Promise<void> {

    if (this.socket) {
      this.socket.close();
      this.socket = null;
      this.connected = false;
    }

    return new Promise((resolve, reject) => {
      try {
        this.socket = io(this.options.url, {
          path: '/api/programs/socket.io',
          transports:['websocket'],
          autoConnect: true,
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionAttempts: Infinity,
          auth: {
            username: this.options.credentials.username,
            password: this.options.credentials.password
          }
        });

        this.socket.on('connect', () => {
          console.log('WebSocket connected');
          this.connected = true;
          if (this.connectedHandler) this.connectedHandler();
          resolve();
        });

        this.socket.on('disconnect', () => {
          console.log('WebSocket disconnected');
          this.connected = false;
          if (this.disconnectedHandler) this.disconnectedHandler();
        });

        this.socket.on('connect_error', (error) => {
          console.error('Connection error:', error);
          if (this.errorHandler) this.errorHandler(error);
          reject(error);
        });

        this.on('terminalsChanged', () => {
          console.log('Received terminalsChanged notification');
          if (this.terminalManager) this.terminalManager.updateTerminalInstancesFromServer();
        });

        this.on('programNameChanged', (data: { terminalId: number, programName: string }) => {
          console.log('Received programNameChanged notification', data);
          if (this.terminalManager) this.terminalManager.programNameChanged(data);
        });

        

        this.on('terminal_exited', (data: { id: number }) => {
          console.log('Received terminal_exited notification', data);
          if (this.terminalManager) this.terminalManager.terminalExited(data);
        });

        this.socket.on('notification', (notification: RPCNotification) => {
          console.log('Received notification:', notification.method, notification.params);

          if (notification.method === 'programStatusChanged' && this.statusChangeHandler) {
            console.log('Processing program status change:', notification.params);
            this.statusChangeHandler(notification.params);
          }
          // Handle initial program list notification
          else if (notification.method === 'initialProgramList' && this.initialProgramListHandler) {
            console.log('Received initial program list:', notification.params);
            // Update the program list directly
            if (Array.isArray(notification.params)) {
              console.log(`Processing ${notification.params.length} programs from initial list`);
              this.initialProgramListHandler(notification.params);
            } else {
              console.warn('Initial program list is not an array:', notification.params);
            }
          }
          // Handle program list updates
          else if (notification.method === 'programListUpdated' && this.programListUpdatedHandler) {
            console.log('Received program list update:', notification.params);
            if (Array.isArray(notification.params)) {
              console.log(`Processing ${notification.params.length} programs from updated list`);
              this.programListUpdatedHandler(notification.params);
            } else {
              console.warn('Updated program list is not an array:', notification.params);
            }
          } else {
            console.log('Unhandled notification method:', notification.method);
          }
        });
      } catch (error) {
        console.error('Failed to initialize WebSocket:', error);
        if (this.errorHandler) this.errorHandler(error);
        reject(error);
      }
    });
  }

  async callRPC(method: string, params: any = {}): Promise<any> {
    if (!this.socket || !this.connected) {
      throw new Error('WebSocket not connected');
    }

    const id = Math.random().toString(36).substr(2, 9);
    const request: RPCRequest = { id, method, params };

    return new Promise((resolve, reject) => {
      this.socket!.emit('rpc', request, (response: RPCResponse) => {
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response.result);
        }
      });
    });
  }

  async login(username: string, password: string): Promise<void> {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }

    this.authCredentials = { username, password };

    return new Promise((resolve, reject) => {
      this.socket!.emit('rpc', {
        jsonrpc: '2.0',
        method: 'login',
        params: { username, password },
        id: Math.random().toString(36).substr(2, 9)
      }, (response: any) => {
        if (response.error) {
          reject(new Error(response.error.message));
        } else {
          resolve();
        }
      });
    });
  }

  getAuthCredentials(): { username: string, password: string } | null {
    return this.authCredentials;
  }

  onStatusChange(handler: (program: any) => void) {
    this.statusChangeHandler = handler;
  }

  onInitialProgramList(handler: (programs: any[]) => void): void {
    this.initialProgramListHandler = handler;
  }

  onProgramListUpdated(handler: (programs: any[]) => void): void {
    this.programListUpdatedHandler = handler;
  }

  onConnected(handler: () => void) {
    this.connectedHandler = handler;
  }

  onDisconnected(handler: () => void) {
    this.disconnectedHandler = handler;
  }

  onError(handler: (error: any) => void) {
    this.errorHandler = handler;
  }

  isConnected(): boolean {
    return this.connected;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
    }
  }
}
