"use client";

import React, { useRef, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { ProgramState } from '@/lib/Program';
import { useWebSocket } from '@/lib/WebSocketContext';
import { TerminalSessionInfo } from '@/lib/TerminalServer';
import { TerminalManager } from '@/lib/TerminalManager';

// Import xterm CSS only on the client side
import 'xterm/css/xterm.css';

// Types for dynamic imports
type XTermType = typeof import('xterm').Terminal;
type FitAddonType = typeof import('xterm-addon-fit').FitAddon;
type WebLinksAddonType = typeof import('xterm-addon-web-links').WebLinksAddon;

interface TerminalProps {
  program?: ProgramState;
  standalone?: boolean;
  onClose: () => void;
}

export const Terminal: React.FC<TerminalProps> = ({ program, standalone = false, onClose }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [terminal, setTerminal] = useState<any>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isAuthenticated, client } = useWebSocket();

  // Initialize terminal
  useEffect(() => {
    let term: any = null;
    let fitAddon: any = null;
    
    const initTerminal = async () => {
      if (!terminalRef.current) return;
      
      try {
        // Get terminal key based on program or standalone mode
        const terminalKey = standalone ? 'standalone' : program?.screenName || '';
        if (!standalone && !program?.screenName) {
          console.error('Cannot initialize terminal: no screen name provided');
          setError('Cannot initialize terminal: no screen name provided');
          return;
        }
        
        // Try to get existing terminal instance
        const existingInstance = TerminalManager.getInstance(terminalKey);
        
        // If we have an existing instance with a connected socket, use it
        if (existingInstance && existingInstance.socket && existingInstance.socket.connected && existingInstance.term) {
          console.log(`Reusing existing terminal instance for ${terminalKey}`);
          
          // Update the last used timestamp
          existingInstance.lastUsed = new Date();
          
          // First, make sure terminalRef is empty to avoid multiple terminals
          if (terminalRef.current) {
            while (terminalRef.current.firstChild) {
              terminalRef.current.removeChild(terminalRef.current.firstChild);
            }
          }
          
          // Set the terminal and socket from the existing instance
          setTerminal(existingInstance.term);
          setSocket(existingInstance.socket);
          setIsConnected(true);
      
          // Reattach the terminal to the DOM
          if (terminalRef.current && existingInstance.term.term) {
            // Check if we have a saved element in the instance
            if (existingInstance.element) {
              console.log('Reusing saved terminal element');
              // Reuse the saved element
              terminalRef.current.appendChild(existingInstance.element);
              if (existingInstance.term.fitAddon) {
                existingInstance.term.fitAddon.fit();
              }
            } else if (existingInstance.term.term.element) {
              console.log('Reusing terminal element from term object');
              // Use the element from the term object
              terminalRef.current.appendChild(existingInstance.term.term.element);
              if (existingInstance.term.fitAddon) {
                existingInstance.term.fitAddon.fit();
              }
            } else {
              console.log('Creating new terminal element');
              // Fallback if element is not available
              existingInstance.term.term.open(terminalRef.current);
              if (existingInstance.term.fitAddon) {
                existingInstance.term.fitAddon.fit();
              }
              // Request a screen refresh to ensure content is up to date
              existingInstance.socket.emit('input', '\x0c'); // Send Ctrl+L to refresh screen
            }
          }
          
          // Request updated list of active terminals
          existingInstance.socket.emit('list_terminals');
          return;
        }
        
        // Dynamic imports to avoid SSR issues
        const xtermModule = await import('xterm');
        const fitAddonModule = await import('xterm-addon-fit');
        const webLinksAddonModule = await import('xterm-addon-web-links');
        
        const XTerm = xtermModule.Terminal;
        const FitAddon = fitAddonModule.FitAddon;
        const WebLinksAddon = webLinksAddonModule.WebLinksAddon;

        // Create terminal instance
        term = new XTerm({
          cursorBlink: true,
          fontSize: 14,
          fontFamily: 'monospace',
          theme: {
            background: '#1e1e1e',
            foreground: '#f0f0f0'
          }
        });

        fitAddon = new FitAddon();
        const webLinksAddon = new WebLinksAddon();
        
        term.loadAddon(fitAddon);
        term.loadAddon(webLinksAddon);
        
        term.open(terminalRef.current);
        fitAddon.fit();
        
        // Write initial message to confirm terminal is working
        term.writeln('Terminal initialized. Connecting to server...');
        
        // Handle window resize
        const handleResize = () => {
          if (fitAddon) fitAddon.fit();
        };
        
        window.addEventListener('resize', handleResize);
        
        const terminalObj = {
          term,
          fitAddon,
          dispose: () => {
            window.removeEventListener('resize', handleResize);
            if (term) term.dispose();
          }
        };
        
        setTerminal(terminalObj);
        
        // Create or update terminal instance in the manager
        const instance = TerminalManager.getOrCreateInstance(
          program?.screenName || 'standalone',
          standalone
        );
        instance.term = terminalObj;
        
        // Connect to WebSocket after terminal is initialized
        connectToWebSocket(term, instance);
        
      } catch (err) {
        console.error('Failed to load terminal:', err);
        setError('Failed to load terminal');
      }
    };
    
    initTerminal();
    
    return () => {
      // Don't dispose the terminal or disconnect the socket on unmount
      // Just detach the terminal from the DOM and save it for later reuse
      if (terminal && terminal.term) {
        try {
          // Get terminal key
          const terminalKey = standalone ? 'standalone' : program?.screenName || '';
          const instance = TerminalManager.getInstance(terminalKey);
          
          // Only detach from DOM, don't dispose
          if (terminal.term.element && terminal.term.element.parentNode) {
            // Store the element reference in the instance for reattachment
            if (instance) {
              // Save the element reference in the instance
              instance.element = terminal.term.element;
              TerminalManager.setInstance(terminalKey, instance);
            }
            terminal.term.element.parentNode.removeChild(terminal.term.element);
          }
        } catch (err) {
          console.error('Error detaching terminal:', err);
        }
      }
    };
  }, [program?.screenName, standalone]);
  
  // Function to connect to WebSocket
  const connectToWebSocket = async (term: any, instance?: any) => {
    if (!isAuthenticated || !client) {
      console.error('Cannot connect to terminal: not authenticated');
      term.writeln('\r\n\x1b[1;31mCannot connect to terminal: not authenticated\x1b[0m');
      return;
    }
    
    // Skip if we need a program but don't have one or it's not active
    if (!standalone && (!program || !program.screenActive)) {
      console.error('Cannot connect to terminal: program not active');
      term.writeln('\r\n\x1b[1;31mCannot connect to terminal: program not active\x1b[0m');
      return;
    }
    
    // Get terminal key based on program or standalone mode
    const terminalKey = standalone ? 'standalone' : program?.screenName || '';
    
    // Get or create terminal instance
    const terminalInstance = instance || TerminalManager.getOrCreateInstance(
      program?.screenName || 'standalone',
      standalone
    );
    
    // If we already have a connected socket in the instance, reuse it
    if (terminalInstance.socket && terminalInstance.socket.connected) {
      console.log(`Reusing existing socket connection for ${terminalKey}`);
      
      // Set up event handlers for the existing socket
      setupSocketEventHandlers(terminalInstance.socket, term);
      
      // Request list of active terminals
      terminalInstance.socket.emit('list_terminals');
      
      // Set the socket state
      setSocket(terminalInstance.socket);
      setIsConnected(true);
      
      return;
    }
    
    // If we get here, we need to create a new connection
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.host;
    const wsUrl = `${wsProtocol}//${wsHost}`;
    
    console.log(`Creating new terminal WebSocket connection at ${wsUrl}`);
    term.writeln(`\r\nConnecting to ${wsUrl}...`);
    
    // Get a token for terminal authentication
    let authToken;
    try {
      term.writeln('\r\nRequesting authentication token...');
      const response = await client.callRPC('generateTerminalToken', {});
      authToken = response.token;
      term.writeln(`\r\n\x1b[1;32mObtained authentication token (expires in ${response.expiresIn}s)\x1b[0m`);
    } catch (error) {
      console.error('Failed to get authentication token:', error);
      term.writeln('\r\n\x1b[1;31mFailed to get authentication token: ' + error + '\x1b[0m');
      return;
    }

    const newSocket = io(wsUrl + '/terminal', {
      path: '/api/programs/socket.io',
      query: {
        screenName: standalone ? 'standalone' : program?.screenName,
        sessionId: terminalInstance.sessionId,
        standalone: standalone ? 'true' : 'false'
      },
      auth: { token: authToken },
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });
    
    // Set up event handlers for the new socket
    setupSocketEventHandlers(newSocket, term);
    
    // Store socket in terminal instance
    terminalInstance.socket = newSocket;
    TerminalManager.setInstance(terminalKey, terminalInstance);
    
    setSocket(newSocket);
  };
  
  // Extract socket event handlers to a separate function to avoid duplication
  const setupSocketEventHandlers = (socket: Socket, term: any) => {
    // Remove any existing listeners to prevent duplicates
    socket.removeAllListeners();
    
    socket.on('connect', () => {
      console.log(`Terminal WebSocket connected`);
      setIsConnected(true);
      term.writeln('\r\n\x1b[1;32mConnected to terminal server\x1b[0m');
      
      // Request to attach to the screen session or start standalone terminal
      if (standalone) {
        console.log('Requesting standalone terminal');
        socket.emit('attach', { standalone: true });
      } else if (program) {
        console.log(`Requesting terminal for screen: ${program.screenName}`);
        socket.emit('attach', { screenName: program.screenName });
      }
      
      // Request list of active terminals
      socket.emit('list_terminals');
    });
    
    socket.on('connect_error', (err) => {
      console.error('Terminal WebSocket connection error:', err);
      term.writeln('\r\n\x1b[1;31mConnection error: ' + err.message + '\x1b[0m');
      setError(err.message);
    });
    
    socket.on('output', (data: string) => {
      console.log(`Received ${data.length} bytes of output from server`);
      term.write(data);
    });
    
    socket.on('connected', (data: any) => {
      console.log('Terminal session connected:', data);
      term.writeln('\r\n\x1b[1;32mTerminal session established\x1b[0m\r\n');
    });
    
    socket.on('disconnect', () => {
      console.log(`Terminal WebSocket disconnected`);
      setIsConnected(false);
      term.writeln('\r\n\x1b[1;31mDisconnected from terminal\x1b[0m');
    });
    
    socket.on('error', (err: string) => {
      console.error('Terminal WebSocket error:', err);
      setError(err);
      term.writeln('\r\n\x1b[1;31mError: ' + err + '\x1b[0m');
    });
    
    // Handle input from terminal
    term.onData((data: string) => {
      if (socket.connected) {
        console.log(`Sending ${data.length} bytes of input to server`);
        socket.emit('input', data);
      }
    });
  };
  
  const switchToTerminal = (screenName: string) => {
    if (!socket || !terminal) return;
    
    // Close current terminal connection
    if (terminal.term) {
      terminal.term.writeln('\r\n\x1b[1;33mSwitching to terminal: ' + screenName + '\x1b[0m');
    }
    
    // Request to attach to the selected screen
    socket.emit('attach', { screenName });
    
    // Update the terminal instance in the manager
    const terminalKey = standalone ? 'standalone' : program?.screenName || '';
    const instance = TerminalManager.getInstance(terminalKey);
    if (instance) {
      instance.screenName = screenName;
      instance.lastUsed = new Date();
      TerminalManager.setInstance(terminalKey, instance);
    }
  };
  
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center p-2 bg-gray-100 border-b">
        <div className="flex items-center">
          <h4 className="text-sm font-semibold">{standalone ? 'Terminal' : `${program?.name} Terminal`}</h4>
          {!standalone && program && <p className="text-xs text-gray-500 ml-2">Screen: {program.screenName}</p>}
          
          <div className="relative ml-4">
                      
         
          </div>
        </div>
        <button 
          onClick={onClose}
          className="px-2 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600"
        >
          Close
        </button>
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
