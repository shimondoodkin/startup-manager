import { Socket } from 'socket.io-client';
import { ProgramState } from './Program';
import { TerminalInstance } from './TerminalManager'; // Use only the type, not the singleton
// All usages of TerminalManager must be refactored to use the instance from context.

// Interface for tab instance
export interface BaseTabInstance {
  id: string;
  active: boolean;
  title: string;
  closable: boolean;
}
export interface ListTabInstance extends BaseTabInstance {
  type: 'list';
}
export interface FormTabInstance extends BaseTabInstance {
  type: 'form';
  program?: ProgramState;
}
export interface TerminalTabInstance extends BaseTabInstance {
  type: 'terminal';
  terminalInstance: TerminalInstance;
}
export type TabInstance = ListTabInstance | FormTabInstance | TerminalTabInstance;

// Singleton class to manage tabs
export class TabsManagerClass {
  private tabs: TabInstance[] = [];
  private activeTabId: string | null = null;
  private listeners: Array<() => void> = [];

  constructor() {
    // Initialize with default list tab
    const listTabId = `list-${Date.now()}`;
    this.tabs = [
      {
        id: listTabId,
        type: 'list',
        active: true,
        title: 'Programs',
        closable: false
      }
    ];
    this.activeTabId = listTabId;
  }

  // Get all tabs
  getTabs(): TabInstance[] {
    return [...this.tabs];
  }

  // Get active tab
  getActiveTab(): TabInstance | null {
    return this.tabs.find(tab => tab.active) || null;
  }

  // Get tab by id
  getTabById(id: string): TabInstance | undefined {
    return this.tabs.find(tab => tab.id === id);
  }

  // Add a new tab
  addTab(newTab: TabInstance): TabInstance {
    // For terminal tabs, we'll set the terminal instance later when the tab is activated
    // This is because we need to request a terminal from the server, which requires async operations
    // The Terminal component will handle requesting the terminal instance when it mounts
    let setActive=newTab.active
    newTab.active=false;
    
    // Add to tabs array
    this.tabs.push(newTab);
    
    // Set as active tab
    if(setActive){
      this.setActiveTab(newTab.id);
    }
    
    // Notify listeners
    this.notifyListeners();
    
    return newTab;
  }

  // Set active tab
  setActiveTab(id: string): boolean {
    // Find tab with given id
    const tabIndex = this.tabs.findIndex(tab => tab.id === id);
    if (tabIndex === -1) return false;
    
    // Update active state for all tabs
    this.tabs.forEach((tab, index) => {
      tab.active = index === tabIndex;
    });
    
    this.activeTabId = id;
    
    // Notify listeners
    this.notifyListeners();
    
    return true;
  }

  // Close a tab
  closeTab(id: string): boolean {
    // Don't allow closing the main list tab
    if (this.tabs.length === 1 || this.tabs[0].id === id && !this.tabs[0].closable) {
      return false;
    }
    
    // Find tab index
    const tabIndex = this.tabs.findIndex(tab => tab.id === id);
    if (tabIndex === -1) return false;
    
    // Get the tab before removing it
    const tabToClose = this.tabs[tabIndex];
    
    // If this is a terminal tab, properly close the terminal instance
    if (tabToClose.type === 'terminal') {
      // If the tab has a terminalInstance with an ID, close it using the terminalManager instance passed from context
      if (tabToClose.terminalInstance && tabToClose.terminalInstance.id) {
        console.log(`Closing terminal instance ${tabToClose.terminalInstance.id} for tab ${id}`);
        // Note: This will send a close_terminal event to the server
        // The server will close the terminal when receiving this event
        // The client is responsible for managing connections to terminals
        // This should be handled by the TabsContainer or parent component using terminalManager from context
        // Example: terminalManager.closeTerminal(tabToClose.terminalInstance.id);
      } else {
        console.warn('Terminal instance not found by id');
      }
    }
    
    // Remove tab
    this.tabs = this.tabs.filter(tab => tab.id !== id);
    
    // If we're closing the active tab, activate the previous tab
    if (tabToClose.active) {
      const newActiveIndex = Math.max(0, tabIndex - 1);
      this.tabs[newActiveIndex].active = true;
      this.activeTabId = this.tabs[newActiveIndex].id;
    }
    
    // Notify listeners
    this.notifyListeners();
    
    return true;
  }

  // Update tab title
  updateTabTitle(id: string, title: string): boolean {
    const tab = this.tabs.find(tab => tab.id === id);
    if (!tab) return false;
    
    tab.title = title;
    
    // Notify listeners
    this.notifyListeners();
    
    return true;
  }

  // Validate terminal tabs against the provided terminalManager instance
  validateTerminalTabs(): void {
    // This is now a placeholder. All terminal tab validation logic should be handled in context-aware components (e.g., TabsContainer) using the terminalManager instance from context.
  }


  // Add a listener for tab changes
  addListener(callback: () => void): void {
    this.listeners.push(callback);
  }

  // Remove a listener
  removeListener(callback: () => void): void {
    this.listeners = this.listeners.filter(listener => listener !== callback);
  }

  // Notify all listeners of changes
  private notifyListeners(): void {
    this.listeners.forEach(listener => listener());
  }
}

// No singleton export. Instantiation is handled by context provider.
