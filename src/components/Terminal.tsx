"use client";

import React, { useRef, useEffect, useState } from 'react';

import { useStartupManager } from '@/lib/StartupManagerContext';

import { TerminalInstance } from '@/lib/TerminalManager';

// Import xterm CSS only on the client side
import 'xterm/css/xterm.css';

// Types for dynamic imports
type XTermType = typeof import('xterm').Terminal;
type FitAddonType = typeof import('xterm-addon-fit').FitAddon;
type WebLinksAddonType = typeof import('xterm-addon-web-links').WebLinksAddon;

interface TerminalProps {
  onClose: () => void;
  terminalInstance?: TerminalInstance;
}

export const Terminal: React.FC<TerminalProps> = ({ onClose, terminalInstance }) => {
  const { isAuthenticated, client, terminalManager } = useStartupManager();
  const terminalRef = useRef<HTMLDivElement>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Force update when terminal instance changes
  useEffect(() => {
    if (terminalInstance) {
      setIsConnected(terminalInstance.connected);
    }
  }, [terminalInstance]);

  // Initialize terminal
  useEffect(() => {
    const initTerminal = async () => {
      if (!terminalInstance) return;
      
      try {
        
        // Use existing terminal instance from props or state if available
        if (terminalInstance) {
          console.log(`Using existing terminal instance ${terminalInstance.id}`);
          
          // Clear terminal container first
          while (terminalRef.current?.firstChild) {
            terminalRef.current.removeChild(terminalRef.current.firstChild);
          }
          
          // Reattach existing terminal to DOM
          const reattached = terminalManager.reattachTerminal(terminalInstance, terminalRef?.current!);
          
          if (reattached) {
            setIsConnected(terminalInstance.connected);
            
            // Set up event handlers for the socket
            if (terminalInstance.term && terminalInstance.socket) {
              terminalManager.setupTerminalEvents(
                terminalInstance,
                terminalInstance.term.term,
                terminalInstance.socket,
                (connected) => setIsConnected(connected)
              );
            }
            return;
          }
        }
        
        // If we get here, we need to find an existing instance or create a new one
        let instanceRef: TerminalInstance | null = null;
        
        // If a terminal instance is provided in the tab props, use that
        // Otherwise, we'll request a new terminal from the server
        
        // If no existing instance found, request a new one from the server
        if (!terminalInstance) {
          console.error('No terminal Instance found');
          setError('No terminal Instance found');
        }
        
        
        // If the instance already has a terminal, just reattach it
        if (terminalInstance.term) {
          const reattached = terminalManager.reattachTerminal(terminalInstance, terminalRef.current!);
          if (reattached) {
            setIsConnected(terminalInstance.connected);
            
            if (terminalInstance.socket) {
              terminalManager.setupTerminalEvents(
                terminalInstance, 
                terminalInstance.term.term, 
                terminalInstance.socket,
                (connected) => setIsConnected(connected)
              );
            }
            return;
          }
        }
        
        // Initialize the terminal if needed
        await terminalManager.initializeTerminal(terminalInstance, terminalRef.current!);
        
        // Connect to WebSocket if needed
        if (isAuthenticated && client) {
          try {
            // Only connect if not already connected
            if (!terminalInstance.socket || !terminalInstance.socket.connected) {
              if (!terminalInstance.term) throw new Error('Terminal object is not initialized');
              const socket = await terminalManager.connectTerminal(terminalInstance, terminalInstance.term.term);
              setIsConnected(terminalInstance.connected);
              
              // Set up event handlers
              if (terminalInstance.term) {
                terminalManager.setupTerminalEvents(
                  terminalInstance, 
                  terminalInstance.term.term, 
                  socket,
                  (connected) => setIsConnected(connected)
                );
              }
            } else {
              // Use existing socket
              setIsConnected(terminalInstance.connected);
              
              // Set up event handlers
              if (terminalInstance.socket) {
                if (terminalInstance.term) {
                  terminalManager.setupTerminalEvents(
                    terminalInstance, 
                    terminalInstance.term.term, 
                    terminalInstance.socket,
                    (connected) => setIsConnected(connected)
                  );
                }
              }
            }
          } catch (err) {
            console.error('Failed to connect terminal:', err);
            setError('Failed to connect terminal');
          }
        } else {
          console.error('Cannot connect to terminal: not authenticated');
          if (terminalInstance.term) (terminalInstance.term as any).writeln('\r\n\x1b[1;31mCannot connect to terminal: not authenticated\x1b[0m');
          setError('Not authenticated');
        }
      } catch (err:any) {
        console.error('Failed to initialize terminal:', err);
        setError('Failed to initialize terminal');
      }
    };
    
    initTerminal();
    
    // Cleanup function that runs when component unmounts or dependencies change
    return () => {
      // Don't dispose the terminal or disconnect the socket on unmount when switching tabs
      // Just detach the terminal from the DOM and save it for later reuse
      if (terminalInstance) {
        console.log(`Detaching terminal ${terminalInstance.id} without disconnecting socket`);
        terminalManager.detachTerminal(terminalInstance);
        
        // Important: We don't disconnect the socket here
        // This allows the connection to be maintained when switching tabs
        // The socket will only be disconnected when the tab is closed via TabsManager.closeTab
      }
    };
  }, [ isAuthenticated, client, terminalInstance]);
  
  // Subscribe to terminal manager changes
  useEffect(() => {
    const handleTerminalManagerChange = () => {
      if (terminalInstance) {
        // Update connection status based on instance state
        setIsConnected(terminalInstance.connected);
      }
    };
    
    terminalManager.addListener(handleTerminalManagerChange);
    
    return () => {
      terminalManager.removeListener(handleTerminalManagerChange);
    };
  }, [terminalInstance]);
  
  // Handle connect button click - adds client to list of connections for a PTY terminal
  const handleConnect = async () => {
    if (!terminalInstance || !client || !isAuthenticated) return;
    
    try {
      // Connect to the terminal if not already connected
      if (!terminalInstance.socket || !terminalInstance.socket.connected) {
        if (terminalInstance.term) {
          const socket = await terminalManager.connectTerminal(terminalInstance, terminalInstance.term.term);
          setIsConnected(terminalInstance.connected);
          
          // Set up event handlers
          terminalManager.setupTerminalEvents(
            terminalInstance,
            terminalInstance.term.term,
            socket,
            (connected) => setIsConnected(connected)
          );
        }
      } else {
        console.log('Terminal is already connected');
        if (terminalInstance.term && terminalInstance.term.term) {
          terminalInstance.term.term.writeln('\r\n\x1b[1;33mAlready connected to terminal\x1b[0m');
        }
      }
    } catch (err) {
      console.error('Failed to connect terminal:', err);
      setError('Failed to connect terminal');
    }
  };

  // Handle disconnect button click - removes client from list of connections for a PTY terminal
  const handleDisconnect = () => {
    if (!terminalInstance) return;

    try {
      // If there's an existing socket, disconnect it
      if (terminalInstance.socket && terminalInstance.socket.connected) {
        console.log(`Disconnecting socket for terminal ${terminalInstance.id}`);
        terminalInstance.socket.disconnect();
        setIsConnected(false);

        if (terminalInstance.term && terminalInstance.term.term) {
          terminalInstance.term.term.writeln('\r\n\x1b[1;31mDisconnected from terminal\x1b[0m');
        }
      } else {
        console.log('Terminal is already disconnected');
      }
    } catch (err) {
      console.error('Error disconnecting terminal:', err);
      setError('Error disconnecting terminal');
    }
  };
  
  // Handle refresh button click - full refresh of terminal state
  const handleRefresh = async () => {
    if (!terminalInstance || !client || !isAuthenticated) return;
    
    try {
      // If there's an existing socket, disconnect it first
      if (terminalInstance.socket && terminalInstance.socket.connected) {
        terminalInstance.socket.disconnect();
      }
      
      // Reconnect
      if (terminalInstance.term) {
        const socket = await terminalManager.connectTerminal(terminalInstance, terminalInstance.term.term);
        setIsConnected(terminalInstance.connected);
        
        // Set up event handlers
        terminalManager.setupTerminalEvents(
          terminalInstance,
          terminalInstance.term.term,
          socket,
          (connected) => setIsConnected(connected)
        );
        
        // Send a refresh command (Ctrl+L) to clear the screen
        if (socket.connected) {
          socket.emit('input', '\x0c');
        }
      }
    } catch (err) {
      console.error('Failed to refresh terminal:', err);
      setError('Failed to refresh terminal');
    }
  };
  
  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center p-2 bg-gray-100 border-b">
        <div className="flex items-center">
          <h4 className="text-sm font-semibold">{terminalInstance?.screenName ? `${terminalInstance.screenName} Terminal` : 'Terminal'}</h4>
          {terminalInstance && terminalInstance.id && <p className="text-xs text-gray-500 ml-2">ID: {terminalInstance.id.substring(0, 8)}...</p>}
          {isConnected && <span className="ml-2 px-2 py-0.5 text-xs bg-green-100 text-green-800 rounded-full">Connected</span>}
          {!isConnected && <span className="ml-2 px-2 py-0.5 text-xs bg-red-100 text-red-800 rounded-full">Disconnected</span>}
          {terminalInstance?.ptyInfo?.connectionCount && terminalInstance.ptyInfo.connectionCount > 1 && (
            <span className="ml-2 px-2 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded-full">
              {terminalInstance.ptyInfo.connectionCount} connections
            </span>
          )}
        </div>
        <div className="flex items-center">
          <button
            onClick={handleConnect}
            className="mr-2 px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600 focus:outline-none"
            disabled={isConnected}
          >
            Connect
          </button>
          <button
            onClick={handleDisconnect}
            className="mr-2 px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 focus:outline-none"
            disabled={!isConnected}
          >
            Disconnect
          </button>
          <button
            onClick={handleRefresh}
            className="mr-2 px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 focus:outline-none"
          >
            Refresh
          </button>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 focus:outline-none"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <div 
        ref={terminalRef} 
        className="flex-grow bg-black"
        style={{ height: 'calc(100vh - 150px)' }}
      ></div>
      {error && (
        <div className="p-2 text-sm text-red-500 bg-red-100">
          Error: {error}
        </div>
      )}
    </div>
  );
};
