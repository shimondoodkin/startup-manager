"use client";

import React, { useState, useEffect } from 'react';
import { StartupManagerProvider } from '@/lib/StartupManagerContext';
import { LoginForm } from './LoginForm';
import { TabsContainer } from './TabsContainer';

export const App: React.FC = () => {
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  
  // Determine the WebSocket URL based on the current window location
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
      const host = window.location.host;
      
      // Just use the base URL without any path
      // The path will be added by the WebSocketClient
      setWsUrl(`${protocol}${host}`);
    }
  }, []);
  
  if (!wsUrl) {
    return <div className="p-4">Loading...</div>;
  }
  
  return (
    <StartupManagerProvider wsUrl={wsUrl}>
      {!isAuthenticated ? (
        <LoginForm onLoginSuccess={() => setIsAuthenticated(true)} />
      ) : (
        <TabsContainer />
      )}
    </StartupManagerProvider>
  );
};
