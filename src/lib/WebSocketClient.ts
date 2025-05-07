import { io, Socket } from 'socket.io-client';
import { RPCRequest, RPCResponse, RPCNotification } from './WebSocketServer';

export interface WebSocketClientOptions {
  url: string;
  credentials: {
    username: string;
    password: string;
  };
}

export class WebSocketClient {
  private socket: Socket | null = null;
  private connected = false;
  private options: WebSocketClientOptions;
  private requestMap = new Map<string, { resolve: Function, reject: Function }>();
  private statusChangeHandler: ((program: any) => void) | null = null;
  private initialProgramListHandler: ((programs: any[]) => void) | null = null;
  private programListUpdatedHandler: ((programs: any[]) => void) | null = null;
  private connectedHandler: (() => void) | null = null;
  private disconnectedHandler: (() => void) | null = null;
  private errorHandler: ((error: any) => void) | null = null;
  private authCredentials: { username: string, password: string } | null = null;

  constructor(options: WebSocketClientOptions) {
    this.options = options;
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
