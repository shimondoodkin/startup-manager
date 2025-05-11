import { Socket, io } from 'socket.io-client';
import { TerminalSessionInfo } from './TerminalServer';

// Types for dynamic imports
// Removed unused dynamic import types to fix lint errors.

// Interface for terminal session info from server
// export interface TerminalSessionInfo {
//   id: string;
//   pid: number;
//   screenName?: string;

//   createdAt: string;
//   connectionCount?: number; // Number of active connections to this PTY
// }

// Interface for terminal instance
export interface TerminalInstance {

  // Server-side PTY information
  id: number;
  pid: number;
  programName?: string;
  createdAt: Date;
  titleNote?: string; // <-- Added titleNote
  // connectionCount?: number; // Number of active connections to this PTY

  //store terminal connection
  socket: Socket | null;
  term: {
    term: import('xterm').Terminal;
    fitAddon: import('xterm-addon-fit').FitAddon;
    webLinksAddon: import('xterm-addon-web-links').WebLinksAddon;
    dispose: () => void;
  } | null;
  element?: HTMLElement; // Store element reference to preserve DOM state

  //some state variables not sure why needed
  inittializing?: boolean;
  inittialized?: boolean;
  lastUsed: Date;
  connected: boolean;   // Flag to indicate if this instance has an active xterm connection
  // onConnectionChange?: (connected: boolean) => void
}

// Singleton class to manage terminal instances
import type { WebSocketClient } from './WebSocketClient';
import { TabsManagerClass } from './TabsManager';

export class TerminalManagerClass {
  terminalExited(data: { id: number; }) {
    this.removeInstance(data.id);
  }


  private client: WebSocketClient | null;
  setClientWebSocket(ws: WebSocketClient) {
    this.client = ws;
  }

  private tabsManager: TabsManagerClass;

  constructor(client: WebSocketClient | null, tabsManager: TabsManagerClass) {
    this.client = client;
    this.tabsManager = tabsManager;
  }

  private instances: Map<number, TerminalInstance> = new Map();
  private listeners: Array<() => void> = [];

  // Create a new terminal instance with server-provided ID
  addTerminalInstance(terminalInfo: TerminalSessionInfo): TerminalInstance {
    // Create a new instance with the server-provided ID
    const newInstance: TerminalInstance = {
      id: terminalInfo.id, // Use server-provided ID
      socket: null,
      term: null,
      programName: terminalInfo.programName || '',
      pid: terminalInfo.pid,
      createdAt: new Date(terminalInfo.createdAt),
      titleNote: terminalInfo.titleNote || '', // <-- Propagate titleNote
      lastUsed: new Date(),
      connected: false,
    };

    // Use the server-provided ID as the key in the map
    this.instances.set(terminalInfo.id, newInstance);
    // this.notifyListeners();
    return newInstance;
  }

  // Request a terminal from the server - reuse existing if available
  async createTerminalOnServer(screenName?: string): Promise<TerminalInstance> {
    if (!this.client) throw new Error('TerminalManager: No client available');
    try {

      // No existing terminal found, create a new one
      let response: TerminalSessionInfo | undefined;
      if (screenName) {
        console.log(`Creating new terminal: screenName=${screenName}`);
        // Request a new terminal from the server
        response = await this.client.callRPC('createTerminal', { shell: `screen -x ${screenName}`, titleNote: screenName });
      } else {
        console.log('Creating new terminal');
        response = await this.client.callRPC('createTerminal', { shell: 'bash' });
      }

      // We need to get the full terminal info using the ID
      if (response && response.id) {
        // Create a new instance with the terminal info
        const newInstance = this.addTerminalInstance(response);
        this.addTabOrActivateTerminal(newInstance);
        return newInstance;
      } else {
        throw new Error('Invalid response from server: missing terminalId');
      }
    } catch (err) {
      console.error('Failed to request terminal from server:', err);
      throw err;
    }
  }

  // Store a terminal instance
  setInstance(id: number, instance: TerminalInstance): void {
    // Ensure id is number
    // let existingInstance = this.instances.get(id);
    // if (existingInstance) {
    //   Object.assign(existingInstance, instance);
    // } else {
    this.instances.set(id, instance);
    // }
    // this.notifyListeners();
  }

  // Get a terminal instance by ID
  getInstance(id: number): TerminalInstance | undefined {
    return this.instances.get(id);
  }

  // List all available terminals from the server
  async listTerminals(): Promise<TerminalSessionInfo[]> {
    if (!this.client) throw new Error('TerminalManager: No client available');
    try {
      const terminals = await this.client.callRPC('listTerminals', {});
      return terminals;
    } catch (err) {
      console.error('Failed to list terminals from server:', err);
      throw err;
    }
  }

  addTabOrActivateTerminal(newInstance: TerminalInstance) {
    const tab = this.tabsManager.getTabById(`terminal-${newInstance.id}`);
    if (tab) {
      this.tabsManager.setActiveTab(tab.id);
    } else {
      this.addTerminalTab(newInstance, true);
    }
  }

  addTerminalTab(instance: TerminalInstance, active: boolean) {
    this.tabsManager.addTab({
      id: `terminal-${instance.id}`,
      type: 'terminal',
      title: `Terminal ${instance.id}${instance.titleNote ? '[' + instance.titleNote + ']' : ''}${instance.programName ? ': ' + instance.programName : ''}`,
      closable: false,
      terminalInstance: instance,
      active: active,
    });
  }

  // Initialize and subscribe to tab changes
  // Standalone function to sync tabs with terminal instances
  updateTabs(): void {

    const currentTabs = this.tabsManager.getTabs();

    // Create tabs for new terminal instances
    this.instances.forEach(instance => {
      const tab = currentTabs.find(tab => tab.type === 'terminal' && tab.terminalInstance && tab.terminalInstance.id === instance.id);
      if (!tab) {
        this.addTerminalTab(instance, false);
      }
      else {
        tab.title = `Terminal ${instance.id}${instance.titleNote ? '[' + instance.titleNote + ']' : ''}${instance.programName ? ': ' + instance.programName : ''}`;
      }
    });

    // Remove tabs whose terminalInstance no longer exists
    currentTabs.forEach(tab => {
      if (tab.type === 'terminal' && tab.terminalInstance) {
        const stillExists = this.instances.has(tab.terminalInstance.id);
        if (!stillExists) {
          this.tabsManager.closeTab(tab.id);
        }
      }
    });
  }


  // Get detailed information about a specific terminal
  async getTerminalInfo(terminalId: string): Promise<TerminalSessionInfo> {
    if (!this.client) throw new Error('TerminalManager: No client available');
    try {
      const terminalInfo = await this.client.callRPC('getTerminalInfo', { id: terminalId });
      return terminalInfo;
    } catch (err) {
      console.error(`Failed to get info for terminal ${terminalId}:`, err);
      throw err;
    }
  }

  // Sync terminal instances with server
  async updateTerminalInstancesFromServer(): Promise<void> {
    if (!this.client) throw new Error('TerminalManager: No client available');
    try {
      // Get all terminals from server
      const serverTerminals = await this.listTerminals();

      // Create local instances for any server terminals we don't have
      for (const serverTerminal of serverTerminals) {
        if (!this.instances.has(serverTerminal.id)) {
          // Create a new instance for this terminal
          this.addTerminalInstance(serverTerminal);
        } else {
          // Update existing instance with latest info from server
          const instance = this.instances.get(serverTerminal.id);
          if (instance) {
            // Update PTY info
            instance.id = serverTerminal.id;
            instance.pid = serverTerminal.pid;
            instance.createdAt = new Date(serverTerminal.createdAt);
            // instance.connectionCount=serverTerminal.connectionCount;

            // Update other properties
            instance.programName = serverTerminal.programName || '';
            instance.lastUsed = new Date(); // Update last used time

            // Store updated instance
            this.setInstance(serverTerminal.id, instance);
          }
        }
      }

      // Remove local instances that no longer exist on server
      const serverTerminalIds = new Set(serverTerminals.map(t => t.id));
      for (const [id] of this.instances.entries()) {
        if (!serverTerminalIds.has(id)) {
          // Close and remove the instance
          this.removeInstance(id);
        }
      }

      this.updateTabs();

      // this.notifyListeners();
    } catch (err) {
      console.error('Failed to sync terminals with server:', err);
      throw err;
    }
  }

  programNameChanged(data: { terminalId: number; programName: string; }) {
    const instance = this.getInstance(data.terminalId);
    if (instance) {
      instance.programName = data.programName;
      const tab = this.tabsManager.getTabById(`terminal-${instance.id}`);
      if (tab)
        tab.title = `Terminal ${instance.id}${instance.titleNote ? '[' + instance.titleNote + ']' : ''}${instance.programName ? ': ' + instance.programName : ''}`;
    }
  }

  // Close a terminal (send closeTerminal RPC) and remove the instance
  async closeTerminal(id: number): Promise<void> {
    const instance = this.instances.get(id);
    if (instance) {
      try {
        // Use the main WebSocketClient to call the closeTerminal RPC method
        if (this.client) {
          console.log(`Calling closeTerminal RPC for terminal ${id} (${instance.programName}) from TerminalManager`);
          await this.client.callRPC('closeTerminal', { id });
        } else {
          console.warn('TerminalManager: No WebSocketClient available to call closeTerminal RPC');
        }

        // Tipicaly not required, as server updates the client, can be here for faast response only
        // this.removeInstance(id);
        // this.updateTabsByTerminalInstances();

        // this.notifyListeners();

        console.log(`Terminal instance ${id} closed and removed`);
      } catch (err) {
        console.error(`Error closing terminal ${id}:`, err);
      }
    } else {
      console.warn(`Terminal instance ${id} not found for closing`);
    }
  }

  // Remove a terminal instance and clean up resources
  removeInstance(id: number): boolean {
    const instance = this.instances.get(id);
    if (instance) {

      // if (this.client && this.client.connected) {
      //   this.client.emit('detach', { id: instance.id });
      // }

      // Dispose terminal if it exists
      if (instance.term && instance.term.dispose) {
        try {
          instance.term.dispose();
        } catch (err) {
          console.error(`Error disposing terminal ${id}:`, err);
        }
      }
    }
    const result = this.instances.delete(id);
    // this.notifyListeners();
    return result;
  }

  // Initialize a terminal instance with xterm.js
  async ensureTerminalInitialized(instance: TerminalInstance): Promise<void> {
    try {
      if (instance.inittializing) {
        console.log(`Terminal instance ${instance.id} is already initializing`);
        // throw new Error('Terminal already initializing');
        return;
      }
      instance.inittializing = true;

      await this.initializeXterm(instance);

      await this.connectTerminal(instance);

      await this.setupTerminalEvents(instance);

      instance.inittialized = true;
      // instance.inittializing=false;
    } catch (err) {
      console.error('Failed to initialize terminal:', err);
      throw err;
    }
  }

  // called by ensureTerminalIsInitialized to create xterm object
  // Initialize a terminal instance with xterm.js
  async initializeXterm(instance: TerminalInstance): Promise<void> {
    try {

      if (instance.term)
        return;

      // Dynamic imports to avoid SSR issues
      const xtermModule = await import('xterm');
      const fitAddonModule = await import('xterm-addon-fit');
      const webLinksAddonModule = await import('xterm-addon-web-links');

      const XTerm = xtermModule.Terminal;
      const FitAddon = fitAddonModule.FitAddon;
      const WebLinksAddon = webLinksAddonModule.WebLinksAddon;

      // Create terminal instance
      const term = new XTerm({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'monospace',
        theme: {
          background: '#1e1e1e',
          foreground: '#f0f0f0'
        }
      });

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();

      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);

      // term.open(domElement);
      // fitAddon.fit();
      // // Write initial message to confirm terminal is working
      // term.writeln('Terminal initialized. Connecting to server...');

      // Handle window resize
      const handleResize = () => {
        if (fitAddon) fitAddon.fit();
      };

      window.addEventListener('resize', handleResize);

      const terminalObj = {
        term,
        fitAddon,
        webLinksAddon,
        dispose: () => {
          window.removeEventListener('resize', handleResize);
          if (term) term.dispose();
        }
      };

      // Store the terminal object in the instance
      instance.term = terminalObj;

      // this.setInstance(instance.id, instance);// is this required to notify react on change

    } catch (err) {
      console.error('Failed to initialize terminal:', err);
      throw err;
    }
  }

  // called by ensureTerminalIsInitialized to do the connection creation part
  // Connect a terminal instance to the WebSocket server
  async connectTerminal(instance: TerminalInstance): Promise<void> {
    try {
      // Use the main WebSocketClient's socket for all terminals
      if (!this.client) {
        throw new Error('WebSocket client not available');
      }
      // No per-terminal socket; just store reference to the shared socket
      // (Assume this.client has a .socket property that is the Socket.IO socket)
      // If not, adapt accordingly
      // @ts-ignore
      instance.socket = this.client.socket;
      instance.lastUsed = new Date();
    } catch (err) {
      console.error('Failed to connect terminal:', err);
      instance.term?.term?.writeln(`\r\n\x1b[1;31mFailed to connect: ${err}\x1b[0m`);
      throw err;
    }
  }

  // called by ensureTerminalIsInitialized to do the websocket setup part
  // Set up event handlers for a terminal instance
  async setupTerminalEvents(instance: TerminalInstance): Promise<void> {

    if (!instance.term) {
      throw new Error('Terminal not initialized');
    }

    if (!instance.socket) {
      throw new Error('Socket not initialized');
    }

    const term: import('xterm').Terminal = instance.term.term;
    const socket: Socket = instance.socket;

    // var resolveConenct: () => void;
    // let deferfedConnect=new Promise<void>((resolve, reject) => {
    //   resolveConenct=resolve;
    // })

    // Set up basic event handlers
    // Only attach once per terminal instance
    if (socket.connected) {
      socket.emit('attach', { id: instance.id });
    } else {
      socket.on('connect', () => {
        socket.emit('attach', { id: instance.id });
      });
    }


    socket.on('connected', (data: TerminalSessionInfo) => {
      console.log('Terminal session connected:', data);
      // term.writeln('\r\n\x1b[1;32mTerminal session established\x1b[0m');
      instance.connected = true;

      // If server sent connection count info, show it
      // if (data.connectionCount && data.connectionCount > 1) {
      //   term.writeln(`\r\n\x1b[1;33mThere are ${data.connectionCount} active connections to this terminal\x1b[0m\r\n`);
      // } else {
      //   term.writeln('\r\n');
      // }

      // Update the instance with connection count info
      // if (instance.connectionCount !== undefined) {
      //   instance.connectionCount = data.connectionCount;
      //   this.setInstance(instance.id, instance);
      // }
    });

    socket.on('output', (payload: { id: number, data: string }) => {
      if (payload.id === instance.id) {
        term.write(payload.data);
      }
    });

    socket.on('size', (size: { cols: number, rows: number }) => {
      term.resize(size.cols, size.rows)
    });

    socket.on('refresh', (payload: { id: number, data: string }) => {
      if (payload.id === instance.id) {
        term.clear();
        term.write(payload.data);
      }
    });

    socket.on('disconnect', () => {
      console.log(`Terminal WebSocket disconnected for ${instance.id}`);
      instance.connected = false;
      //  this.setInstance(instance.id, instance);
      // instance.onConnectionChange?.(false);
      term.writeln('\r\n\x1b[1;31mDisconnected from terminal\x1b[0m');
    });


    socket.on('connect_error', (err) => {
      console.error('Terminal WebSocket connection error:', err);
      term.writeln('\r\n\x1b[1;31mConnection error: ' + err.message + '\x1b[0m');
      instance.connected = false;
      //  this.setInstance(instance.id, instance); // is this to update react
      // instance.onConnectionChange?.(false);
    });


    socket.on('error', (err: string) => {
      console.error('Terminal WebSocket error:', err);
      term.writeln('\r\n\x1b[1;31mError: ' + err + '\x1b[0m');
    });

    // Handle terminal closed by server
    socket.on('terminal_closed', () => {
      console.log(`Terminal ${instance.id} closed by server`);
      instance.connected = false;

      // Clean up the terminal instance
      if (instance.term && instance.term.dispose) {
        try {
          instance.term.dispose();
        } catch (termErr) {
          console.error(`Error disposing terminal ${instance.id}:`, termErr);
        }
      }

      // Remove the instance from our map
      this.instances.delete(instance.id);
      // this.notifyListeners();

      term.writeln('\r\n\x1b[1;31mTerminal closed by server\x1b[0m');
      // instance.onConnectionChange?.(false);
    });

    // Listen for connection count updates from server
    // socket.on('connectionCountChanged', (data: { count: number }) => {
    //   console.log(`Terminal ${instance.id} connection count changed to ${data.count}`);

    //   // // Update the instance with new connection count
    //   // if (instance.connectionCount) {
    //   //   instance.connectionCount = data.count;
    //   //   this.setInstance(instance.id, instance);
    //   // }

    //   // Show message in terminal
    //   if (data.count > 1) {
    //     term.writeln(`\r\n\x1b[1;33mThere are now ${data.count} active connections to this terminal\x1b[0m`);
    //   }
    // });

    // Handle input from terminal
    term.onData((data: string) => {
      if (socket.connected) {
        socket.emit('input', { id: instance.id, data });
      }
    });

    // Update last used timestamp
    instance.lastUsed = new Date();
    // this.setInstance(instance.id, instance);
    // await deferfedConnect;
  }

  // Detach a terminal from the DOM without disposing it
  detachTerminal(instance: TerminalInstance): void {
  }

  // Reattach a terminal to the DOM
  reattachTerminal(instance: TerminalInstance, domElement: HTMLElement): boolean {
    return true;
  }

  // Get terminal instance by ID
  getInstanceById(id: number): TerminalInstance | undefined {
    return this.instances.get(id);
  }

  // Get all terminal instances
  getAllInstances(): TerminalInstance[] {
    return Array.from(this.instances.values());
  }

  // // Add a listener for terminal instance changes
  // addListener(callback: () => void): void {
  //   this.listeners.push(callback);
  // }

  // // Remove a listener
  // removeListener(callback: () => void): void {
  //   this.listeners = this.listeners.filter(listener => listener !== callback);
  // }

  // // Notify all listeners of changes
  // private notifyListeners(): void {
  //   this.listeners.forEach(listener => listener());
  // }

  // Clean up old instances (can be called periodically)
  // cleanupOldInstances(maxAgeMinutes: number = 30): void {
  //   const now = new Date();
  //   for (const [key, instance] of this.instances.entries()) {
  //     const ageMinutes = (now.getTime() - instance.lastUsed.getTime()) / (1000 * 60);
  //     if (ageMinutes > maxAgeMinutes) {
  //       // Disconnect socket if it exists
  //       if (instance.socket && instance.socket.connected) {
  //         instance.socket.disconnect();
  //       }
  //       // Dispose terminal if it exists
  //       if (instance.term && instance.term.dispose) {
  //         instance.term.dispose();
  //       }
  //       // Remove instance
  //       this.instances.delete(key);
  //     }
  //   }
  //   this.notifyListeners();
  // }
}


