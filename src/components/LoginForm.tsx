"use client";

import React, { useState } from 'react';
import { useStartupManager } from '@/lib/StartupManagerContext';
import { useTheme } from '@/lib/ThemeContext';
import { ThemeToggle } from './ThemeToggle';

interface LoginFormProps {
  onLoginSuccess: () => void;
}

export const LoginForm: React.FC<LoginFormProps> = ({ onLoginSuccess }) => {
  const { login, error } = useStartupManager();
  const { theme } = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username || !password) {
      setLoginError('Username and password are required');
      return;
    }
    
    setIsLoading(true);
    setLoginError(null);
    
    try {
      await login(username, password);
      onLoginSuccess();
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen" style={{ background: 'var(--background)' }}>
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md p-8 space-y-8 rounded-lg shadow-md" style={{ background: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
        <div className="text-center">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground)' }}>Startup Manager</h1>
          <p className="mt-2" style={{ color: 'var(--foreground)', opacity: 0.7 }}>Sign in to manage your programs</p>
        </div>
        
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {loginError && (
            <div className="p-4 mb-4 text-sm text-red-700 bg-red-100 rounded-lg">
              {loginError}
            </div>
          )}
          
          <div>
            <label htmlFor="username" className="block text-sm font-medium" style={{ color: 'var(--foreground)' }}>
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--foreground)' }}
              className="block w-full px-3 py-2 mt-1 border rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          
          <div>
            <label htmlFor="password" className="block text-sm font-medium" style={{ color: 'var(--foreground)' }}>
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--foreground)' }}
              className="block w-full px-3 py-2 mt-1 border rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          
          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="flex justify-center w-full px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-indigo-400"
            >
              {isLoading ? 'Signing in...' : 'Sign in'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
