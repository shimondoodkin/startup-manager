import { Socket } from 'socket.io-client';
import { TerminalSessionInfo } from './TerminalServer';

// Interface for terminal instance
export interface TerminalInstance {
  id: string;
  socket: Socket | null;
  term: any;
  screenName: string;
  standalone: boolean;
  sessionId: string;
  lastUsed: Date;
  // Store element reference to preserve DOM state
  element?: HTMLElement;
}

// Singleton class to manage terminal instances
class TerminalManagerClass {
  private instances: Map<string, TerminalInstance> = new Map();
  private activeTerminals: TerminalSessionInfo[] = [];

  // Create or get a terminal instance
  getOrCreateInstance(screenName: string, standalone: boolean = false): TerminalInstance {
    // Generate a unique key for this terminal
    const key = standalone ? 'standalone' : screenName;
    
    // Check if we already have an instance for this key
    if (this.instances.has(key)) {
      const instance = this.instances.get(key)!;
      instance.lastUsed = new Date();
      return instance;
    }
    
    // Create a new instance
    const newInstance: TerminalInstance = {
      id: `term-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      socket: null,
      term: null,
      screenName,
      standalone,
      sessionId: Date.now().toString(),
      lastUsed: new Date()
    };
    
    this.instances.set(key, newInstance);
    return newInstance;
  }

  // Store a terminal instance
  setInstance(key: string, instance: TerminalInstance): void {
    this.instances.set(key, instance);
  }

  // Get a terminal instance
  getInstance(key: string): TerminalInstance | undefined {
    return this.instances.get(key);
  }

  // Remove a terminal instance
  removeInstance(key: string): boolean {
    return this.instances.delete(key);
  }

  // Store active terminals list
  setActiveTerminals(terminals: TerminalSessionInfo[]): void {
    this.activeTerminals = terminals;
  }

  // Get active terminals list
  getActiveTerminals(): TerminalSessionInfo[] {
    return this.activeTerminals;
  }

  // Clean up old instances (can be called periodically)
  cleanupOldInstances(maxAgeMinutes: number = 30): void {
    const now = new Date();
    for (const [key, instance] of this.instances.entries()) {
      const ageMinutes = (now.getTime() - instance.lastUsed.getTime()) / (1000 * 60);
      if (ageMinutes > maxAgeMinutes) {
        // Disconnect socket if it exists
        if (instance.socket && instance.socket.connected) {
          instance.socket.disconnect();
        }
        // Dispose terminal if it exists
        if (instance.term && instance.term.dispose) {
          instance.term.dispose();
        }
        // Remove instance
        this.instances.delete(key);
      }
    }
  }
}

// Export singleton instance
export const TerminalManager = new TerminalManagerClass();
