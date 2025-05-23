"use client";

import React, { useState, useEffect } from 'react';
import { ProgramState, StopMethod } from '@/lib/Program';
import { useStartupManager } from '@/lib/StartupManagerContext';
import { useTheme } from '@/lib/ThemeContext';

interface ProgramFormProps {
  program?: ProgramState;
  onCancel: () => void;
  onSave: () => void;
}

export const ProgramForm: React.FC<ProgramFormProps> = ({ program, onCancel, onSave }) => {
  const { addProgram, updateProgram, deleteProgram } = useStartupManager();
  const { theme } = useTheme();
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [screenName, setScreenName] = useState('');
  const [maxChildDepth, setMaxChildDepth] = useState(1);
  const [autoStart, setAutoStart] = useState(false);
  const [stopMethod, setStopMethod] = useState<StopMethod>('SIGHUP');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  
  const isEditMode = !!program;
  
  useEffect(() => {
    if (program) {
      setName(program.name);
      setCommand(program.command);
      setScreenName(program.screenName);
      setMaxChildDepth(program.maxChildDepth || 1);
      setAutoStart(program.autoStart || false);
      setStopMethod(program.stopMethod || 'SIGHUP');
    }
  }, [program]);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name || !command) {
      setError('Name and command are required');
      return;
    }
    
    const programData = {
      name,
      command,
      screenName,
      maxChildDepth,
      autoStart,
      stopMethod
    };
    
    setIsLoading(true);
    setError(null);
    
    try {
      if (isEditMode && program) {
        await updateProgram(program.id, programData);
      } else {
        await addProgram(programData);
      }
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save program');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!isEditMode || !program) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      await deleteProgram(program.id);
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete program');
      setIsLoading(false);
    }
  };
  
  return (
    <div className="shadow sm:rounded-lg" style={{ background: 'var(--card-bg)' }}>
      <div className="px-4 py-5 sm:p-6">
        <h3 className="text-lg font-medium leading-6" style={{ color: 'var(--foreground)' }}>
          {isEditMode ? 'Edit Program' : 'Add Program'}
        </h3>
        <div className="mt-5">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="p-4 text-sm text-red-700 bg-red-100 rounded-lg">
                {error}
              </div>
            )}
            
            <div>
              <label htmlFor="name" className="block text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                Name
              </label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 block w-full border rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                style={{ background: 'var(--input-bg)', color: 'var(--foreground)', borderColor: 'var(--input-border)' }}
                placeholder="Program name"
                required
              />
            </div>
            
            <div>
              <label htmlFor="command" className="block text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                Command
              </label>
              <textarea
                id="command"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                rows={4}
                className="mt-1 block w-full border rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                style={{ background: 'var(--input-bg)', color: 'var(--foreground)', borderColor: 'var(--input-border)' }}
                placeholder="Command and arguments to run"
                required
              />
            </div>
            
            <div>
              <label htmlFor="screenName" className="block text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                Screen Name
              </label>
              <input
                type="text"
                id="screenName"
                value={screenName}
                onChange={(e) => setScreenName(e.target.value)}
                className="mt-1 block w-full border rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                style={{ background: 'var(--input-bg)', color: 'var(--foreground)', borderColor: 'var(--input-border)' }}
                placeholder="Screen session name"
              />
              <p className="mt-1 text-sm" style={{ color: 'var(--foreground)', opacity: 0.7 }}>
                Name for the screen session that will run this program
              </p>
            </div>
            
            <div>
              <label htmlFor="maxChildDepth" className="block text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                Max Child Depth
              </label>
              <input
                type="number"
                id="maxChildDepth"
                min={0}
                value={maxChildDepth}
                onChange={(e) => setMaxChildDepth(parseInt(e.target.value))}
                className="mt-1 block w-full border rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                style={{ background: 'var(--input-bg)', color: 'var(--foreground)', borderColor: 'var(--input-border)' }}
              />
              <p className="mt-1 text-sm" style={{ color: 'var(--foreground)', opacity: 0.7 }}>
                Maximum level of child process depth to monitor
              </p>
            </div>
            
            <div className="flex items-start">
              <div className="flex items-center h-5">
                <input
                  id="autoStart"
                  name="autoStart"
                  type="checkbox"
                  checked={autoStart}
                  onChange={(e) => setAutoStart(e.target.checked)}
                  className="focus:ring-indigo-500 h-4 w-4 text-indigo-600 border-gray-300 rounded"
                />
              </div>
              <div className="ml-3 text-sm">
                <label htmlFor="autoStart" className="font-medium" style={{ color: 'var(--foreground)' }}>
                  Auto Start
                </label>
                <p style={{ color: 'var(--foreground)', opacity: 0.7 }}>
                  Automatically start this program when the manager starts
                </p>
              </div>
            </div>
            
            <div>
              <label htmlFor="stopMethod" className="block text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                Stop Method
              </label>
              <select
                id="stopMethod"
                value={stopMethod}
                onChange={(e) => setStopMethod(e.target.value as StopMethod)}
                className="mt-1 block w-full border rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                style={{ background: 'var(--input-bg)', color: 'var(--foreground)', borderColor: 'var(--input-border)' }}
              >
                <option value="SIGHUP">SIGHUP (Hangup Signal)</option>
                <option value="SIGINT">SIGINT (Interrupt Signal)</option>
                <option value="CTRL_C">CTRL+C (Send to Screen)</option>
              </select>
              <p className="mt-1 text-sm" style={{ color: 'var(--foreground)', opacity: 0.7 }}>
                Method used to stop the program when requested
              </p>
            </div>
            
            <div className="flex justify-end space-x-3">
              {isEditMode && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                >
                  Delete
                </button>
              )}
              <button
                type="button"
                onClick={onCancel}
                className="py-2 px-4 border rounded-md shadow-sm text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                style={{ background: 'var(--btn-more-bg)', color: 'var(--btn-more-text)', borderColor: 'var(--border-color)' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-indigo-400"
              >
                {isLoading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 overflow-y-auto" onClick={() => setConfirmDelete(false)}>
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 opacity-75" style={{ background: 'rgba(0, 0, 0, 0.5)' }}></div>
            </div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="inline-block align-bottom rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full" style={{ background: 'var(--card-bg)' }}>
              <div className="px-4 pt-5 pb-4 sm:p-6 sm:pb-4" style={{ background: 'var(--card-bg)' }}>
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                    <svg className="h-6 w-6 text-red-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                    <h3 className="text-lg leading-6 font-medium" style={{ color: 'var(--foreground)' }}>Delete Program</h3>
                    <div className="mt-2">
                      <p className="text-sm" style={{ color: 'var(--foreground)', opacity: 0.7 }}>
                        Are you sure you want to delete {name}? This action cannot be undone.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse" style={{ background: 'var(--header-bg)' }}>
                <button
                  type="button"
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm"
                  onClick={handleDelete}
                >
                  Delete
                </button>
                <button
                  type="button"
                  className="mt-3 w-full inline-flex justify-center rounded-md border shadow-sm px-4 py-2 text-base font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                  style={{ background: 'var(--btn-more-bg)', color: 'var(--btn-more-text)', borderColor: 'var(--border-color)' }}
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
