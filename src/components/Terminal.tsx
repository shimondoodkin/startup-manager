"use client";

import React, { useRef, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { ProgramState } from '@/lib/Program';
import { useWebSocket } from '@/lib/WebSocketContext';
import { TerminalSessionInfo } from '@/lib/TerminalServer';

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
  const [activeTerminals, setActiveTerminals] = useState<TerminalSessionInfo[]>([]);
  const [showTerminalList, setShowTerminalList] = useState(false);
  const { isAuthenticated, client } = useWebSocket();

  // Initialize terminal
  useEffect(() => {
    let term: any = null;
    let fitAddon: any = null;
    
    const initTerminal = async () => {
      if (!terminalRef.current) return;
      
      try {
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
        
        setTerminal({
          term,
          fitAddon,
          dispose: () => {
            window.removeEventListener('resize', handleResize);
            if (term) term.dispose();
          }
        });
        
        // Connect to WebSocket after terminal is initialized
        connectToWebSocket(term);
        
      } catch (err) {
        console.error('Failed to load terminal:', err);
        setError('Failed to load terminal');
      }
    };
    
    initTerminal();
    
    return () => {
      if (terminal && terminal.dispose) {
        terminal.dispose();
      }
      
      if (socket) {
        socket.disconnect();
      }
    };
  }, []);
  
  // Function to connect to WebSocket
  const connectToWebSocket = (term: any) => {
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
    
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.host;
    const wsUrl = `${wsProtocol}//${wsHost}`;
    
    console.log(`Connecting to terminal WebSocket at ${wsUrl}`);
    term.writeln(`\r\nConnecting to ${wsUrl}...`);
    
    // Get auth credentials from the main WebSocket client
    const credentials = client.getAuthCredentials();
    
    const newSocket = io(wsUrl, {
      path: '/api/programs/terminal/socket.io',
      query: {
        screenName: standalone ? 'standalone' : program?.screenName,
        sessionId: Date.now().toString(),
        standalone: standalone ? 'true' : 'false'
      },
      auth: credentials || { username: 'admin', password: 'admin' },
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });
    
    newSocket.on('connect', () => {
      console.log(`Terminal WebSocket connected`);
      setIsConnected(true);
      term.writeln('\r\n\x1b[1;32mConnected to terminal server\x1b[0m');
      
      // Request to attach to the screen session or start standalone terminal
      if (standalone) {
        console.log('Requesting standalone terminal');
        newSocket.emit('attach', { standalone: true });
      } else if (program) {
        console.log(`Requesting terminal for screen: ${program.screenName}`);
        newSocket.emit('attach', { screenName: program.screenName });
      }
      
      // Request list of active terminals
      newSocket.emit('list_terminals');
    });
    
    newSocket.on('connect_error', (err) => {
      console.error('Terminal WebSocket connection error:', err);
      term.writeln('\r\n\x1b[1;31mConnection error: ' + err.message + '\x1b[0m');
      setError(err.message);
    });
    
    newSocket.on('output', (data: string) => {
      console.log(`Received ${data.length} bytes of output from server`);
      term.write(data);
    });
    
    newSocket.on('connected', (data: any) => {
      console.log('Terminal session connected:', data);
      term.writeln('\r\n\x1b[1;32mTerminal session established\x1b[0m\r\n');
    });
    
    newSocket.on('active_terminals', (terminals: TerminalSessionInfo[]) => {
      console.log('Received active terminals list:', terminals);
      setActiveTerminals(terminals);
    });
    
    newSocket.on('disconnect', () => {
      console.log(`Terminal WebSocket disconnected`);
      setIsConnected(false);
      term.writeln('\r\n\x1b[1;31mDisconnected from terminal\x1b[0m');
    });
    
    newSocket.on('error', (err: string) => {
      console.error('Terminal WebSocket error:', err);
      setError(err);
      term.writeln('\r\n\x1b[1;31mError: ' + err + '\x1b[0m');
    });
    
    // Handle input from terminal
    term.onData((data: string) => {
      if (newSocket.connected) {
        console.log(`Sending ${data.length} bytes of input to server`);
        newSocket.emit('input', data);
      }
    });
    
    setSocket(newSocket);
  };
  
  const switchToTerminal = (screenName: string) => {
    if (!socket || !terminal) return;
    
    // Close current terminal connection
    if (terminal.term) {
      terminal.term.writeln('\r\n\x1b[1;33mSwitching to terminal: ' + screenName + '\x1b[0m');
    }
    
    // Request to attach to the selected screen
    socket.emit('attach', { screenName });
    setShowTerminalList(false);
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
            <button 
              onClick={() => setShowTerminalList(!showTerminalList)}
              className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Terminals ({activeTerminals.length})
            </button>
            
            {showTerminalList && activeTerminals.length > 0 && (
              <div className="absolute top-full left-0 mt-1 bg-white border rounded shadow-lg z-10 w-64">
                <div className="p-2 border-b text-xs font-semibold">Active Terminals</div>
                <ul className="max-h-48 overflow-y-auto">
                  {activeTerminals.map(term => (
                    <li 
                      key={term.id}
                      className="p-2 hover:bg-gray-100 cursor-pointer text-xs border-b flex justify-between items-center"
                      onClick={() => switchToTerminal(term.screenName)}
                    >
                      <div>
                        <div className="font-medium">{term.title}</div>
                        <div className="text-gray-500">{term.screenName}</div>
                      </div>
                      <div className="text-gray-400 text-xs">{formatDate(term.createdAt)}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
