  "use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { WebSocketClient } from './WebSocketClient';
import { ProgramState } from './Program';

interface WebSocketContextType {
  client: WebSocketClient | null;
  isConnected: boolean;
  isAuthenticated: boolean;
  error: Error | null;
  programs: ProgramState[];
  login: (username: string, password: string) => Promise<void>;
  refreshPrograms: () => Promise<void>;
  addProgram: (program: any) => Promise<void>;
  updateProgram: (id: string, program: any) => Promise<void>;
  deleteProgram: (id: string) => Promise<void>;
  startProgram: (id: string) => Promise<void>;
  stopProgram: (id: string) => Promise<void>;
  terminateProgram: (id: string) => Promise<void>;
  startScreen: (id: string) => Promise<void>;
  sendCommandToScreen: (id: string, command: string) => Promise<void>;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

interface WebSocketProviderProps {
  children: ReactNode;
  wsUrl?: string;
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({ 
  children,
  wsUrl 
}) => {
  const [client, setClient] = useState<WebSocketClient | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [programs, setPrograms] = useState<ProgramState[]>([]);

  // Create WebSocket client instance
  useEffect(() => {
    if (!wsUrl) return;

    const ws = new WebSocketClient({
      url: wsUrl,
      credentials: { username: '', password: '' }
    });

    ws.onConnected(() => {
      setIsConnected(true);
      if (isAuthenticated) {
        refreshPrograms();
      }
    });

    ws.onDisconnected(() => {
      setIsConnected(false);
    });

    ws.onError((err) => {
      setError(err instanceof Error ? err : new Error(String(err)));
      setIsConnected(false);
      setIsAuthenticated(false);
    });

    ws.onStatusChange((program) => {
      console.log('Status change received in context:', program);
      setPrograms(currentPrograms => {
        const index = currentPrograms.findIndex(p => p.id === program.id);
        if (index >= 0) {
          console.log(`Updating existing program ${program.id} (${program.name}) in state`);
          const newPrograms = [...currentPrograms];
          newPrograms[index] = program;
          return newPrograms;
        }
        console.log(`Adding new program ${program.id} (${program.name}) to state`);
        return [...currentPrograms, program];
      });
    });

    ws.onInitialProgramList((programsList) => {
      console.log('Initial program list received in context:', programsList);
      setPrograms(programsList);
    });

    ws.onProgramListUpdated((programsList) => {
      console.log('Program list update received in context:', programsList);
      setPrograms(programsList);
    });

    setClient(ws);

    return () => {
      ws.disconnect();
    };
  }, [wsUrl]);

  const login = async (username: string, password: string) => {
    if (!client) throw new Error('WebSocket client not initialized');
    
    // Update credentials
    client['options'].credentials = { username, password };
    
    try {
      await client.connect();
      setIsAuthenticated(true);
      await refreshPrograms();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  };

  const refreshPrograms = async () => {
    if (!client || !isAuthenticated) return;
    
    try {
      const programsList = await client.callRPC('listPrograms');
      setPrograms(programsList);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  };

  const addProgram = async (program: any) => {
    if (!client || !isAuthenticated) return;
    
    try {
      await client.callRPC('addProgram', program);
      await refreshPrograms();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  };

  const updateProgram = async (id: string, program: any) => {
    if (!client || !isAuthenticated) return;
    
    try {
      await client.callRPC('editProgram', { id, ...program });
      await refreshPrograms();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  };

  const deleteProgram = async (id: string) => {
    if (!client || !isAuthenticated) return;
    
    try {
      await client.callRPC('deleteProgram', { id });
      await refreshPrograms();
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  };

  const startProgram = async (id: string) => {
    if (!client || !isAuthenticated) return;
    
    try {
      await client.callRPC('startProgram', { id });
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  };

  const stopProgram = async (id: string) => {
    if (!client || !isAuthenticated) return;
    
    try {
      await client.callRPC('stopProgram', { id });
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  };

  const terminateProgram = async (id: string) => {
    if (!client || !isAuthenticated) return;
    
    try {
      await client.callRPC('terminateProgram', { id });
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  };

  const startScreen = async (id: string) => {
    if (!client || !isAuthenticated) return;
    
    try {
      await client.callRPC('startScreen', { id });
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  };

  const sendCommandToScreen = async (id: string, command: string) => {
    if (!client || !isAuthenticated) return;
    
    try {
      await client.callRPC('sendCommandToScreen', { id, command });
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  };

  return (
    <WebSocketContext.Provider value={{
      client,
      isConnected,
      isAuthenticated,
      error,
      programs,
      login,
      refreshPrograms,
      addProgram,
      updateProgram,
      deleteProgram,
      startProgram,
      stopProgram,
      terminateProgram,
      startScreen,
      sendCommandToScreen
    }}>
      {children}
    </WebSocketContext.Provider>
  );
};
