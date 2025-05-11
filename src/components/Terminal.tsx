"use client";

import React, { useRef, useEffect, useState } from 'react';

import { useStartupManager } from '@/lib/StartupManagerContext';
import { useTheme } from '@/lib/ThemeContext';
import { TerminalInstance } from '@/lib/TerminalManager';

// Import xterm CSS only on the client side
import 'xterm/css/xterm.css';

// Types for dynamic imports
type XTermType = typeof import('xterm').Terminal;
type FitAddonType = typeof import('xterm-addon-fit').FitAddon;
type WebLinksAddonType = typeof import('xterm-addon-web-links').WebLinksAddon;

interface TerminalProps {
  onClose: () => void;
  terminalInstance: TerminalInstance;
}

export const Terminal: React.FC<TerminalProps> = ({ onClose, terminalInstance }) => {
  const { terminalManager } = useStartupManager();
  const { theme } = useTheme();
  const terminalRef = useRef<HTMLDivElement>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [terminated, setTerminated] = useState(false);


  useEffect(() => {
    terminalManager.ensureTerminalInitialized(terminalInstance);

    if (terminalInstance?.inittialized) {
      let firstTime = false;
      if (!terminalInstance.element) {
        let element = document.createElement('div');
        element.style.height = '100%';
        element.style.width = '100%';
        terminalInstance.element = element;

        // term.open( terminalInstance.element );
        // fitAddon.fit();
        // // Write initial message to confirm terminal is working
        // term.writeln('Terminal initialized. Connecting to server...');

        // terminalManager.setInstance(terminalInstance.id, terminalInstance);
        firstTime = true;
      }

      if (terminalInstance.element && terminalRef.current && !terminalRef?.current?.firstChild) {
        terminalRef.current.appendChild(terminalInstance.element);
      }

      setTimeout(() => {
        if (firstTime) {
          if (!terminalInstance.term || !terminalInstance.element) return;
          (terminalInstance.term as any).term.open(terminalInstance.element);
          (terminalInstance.term as any).fitAddon.fit();
        }
      }, 20)
    }
  }, [terminalInstance.inittialized]);

  // Force update when terminal instance changes
  useEffect(() => {
    setIsConnected(!!terminalInstance?.connected);
  }, [terminalInstance, terminalInstance?.connected]);

  // Handle refresh button click - full refresh of terminal state
  const handleRefresh = async () => {
    if (terminalInstance.socket && terminalInstance.socket.connected) {
      terminalInstance.socket.emit('refresh', { id: terminalInstance.id }); // Send Ctrl+L to refresh screen
    }
  };

  // Handle terminate button click
  const handleTerminate = async () => {
    try {
      setError(null);
      await terminalManager.closeTerminal(terminalInstance.id);
      setTerminated(true);
      // Optionally: update tab closability here if API exists
    } catch (err: any) {
      setError('Failed to terminate terminal.');
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center p-2 border-b" style={{ background: 'var(--header-bg)', borderColor: 'var(--border-color)' }}>
        <div className="flex items-center">
          <h4 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>{terminalInstance?.programName ? `${terminalInstance.programName} Terminal` : 'Terminal'}</h4>
          {terminalInstance && terminalInstance.id && <p className="text-xs ml-2" style={{ color: 'var(--foreground)', opacity: 0.7 }}>ID: {terminalInstance.id}</p>}
          {isConnected && <span className="ml-2 px-2 py-0.5 text-xs bg-green-100 text-green-800 rounded-full">Connected</span>}
          {!isConnected && <span className="ml-2 px-2 py-0.5 text-xs bg-red-100 text-red-800 rounded-full">Disconnected</span>}
          {/* {terminalInstance?.connectionCount && terminalInstance.connectionCount > 1 && (
            <span className="ml-2 px-2 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded-full">
              {terminalInstance.connectionCount} connections
            </span>
          )} */}
        </div>
        <div className="flex items-center">
          <button
            onClick={handleRefresh}
            className="mr-2 px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 focus:outline-none"
            disabled={terminated}
          >
            Refresh
          </button>
          <button
            onClick={handleTerminate}
            className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 focus:outline-none"
            disabled={terminated}
          >
            Terminate
          </button>
        </div>
      </div>
      <div
        ref={terminalRef}
        className="flex-grow bg-black"
        style={{ height: 'calc(100vh - 150px)' }}
      ></div>
      {terminated && (
        <div className="p-2 text-sm" style={{ background: 'rgba(220, 38, 38, 0.1)', color: 'var(--foreground)' }}>
          Terminal has been terminated.
        </div>
      )}
      {error && (
        <div className="p-2 text-sm text-red-500" style={{ background: 'rgba(220, 38, 38, 0.1)' }}>
          Error: {error}
        </div>
      )}
    </div>
  );
};
