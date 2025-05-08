"use client";

import React, { useState } from 'react';
import { useStartupManager } from '@/lib/StartupManagerContext';
import { ProgramState } from '@/lib/Program';

interface ProgramListProps {
  onEdit: (program: ProgramState) => void;
  onTerminal: (program: ProgramState) => void;
}

export const ProgramList: React.FC<ProgramListProps> = ({ onEdit, onTerminal }) => {
  const { programs, startProgram, stopProgram, terminateProgram, startScreen } = useStartupManager();

  const handleAction = async (action: string, programId: string) => {
    try {
      switch (action) {
        case 'start':
          await startProgram(programId);
          break;
        case 'stop':
          await stopProgram(programId);
          break;
        case 'terminate':
          await terminateProgram(programId);
          break;
        case 'screen':
          await startScreen(programId);
          break;
        default:
          break;
      }
    } catch (error) {
      console.error(`Error performing ${action}:`, error);
    }
  };

  const getStatusClass = (status: string, screenActive: boolean) => {
    if (status === 'stopped' && screenActive) {
      return 'bg-yellow-100 text-yellow-800'; // Special case for screen active but program stopped
    }
    
    switch (status) {
      case 'running':
        return 'bg-green-100 text-green-800';
      case 'stopped':
        return 'bg-gray-100 text-gray-800';
      case 'error':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string, screenActive: boolean) => {
    if (status === 'stopped' && screenActive) {
      return 'screen only'; // Special case for screen active but program stopped
    }
    return status;
  };

  return (
    <div className="overflow-hidden bg-white shadow sm:rounded-lg">
      <div className="px-4 py-5 sm:px-6">
        <h3 className="text-lg font-medium leading-6 text-gray-900">Programs</h3>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          List of managed programs and their status
        </p>
      </div>
      
      {programs.length === 0 ? (
        <div className="p-6 text-center text-gray-500">
          No programs found. Click 'Add Program' to get started.
        </div>
      ) : (
        <div className="border-t border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Screen</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">PID</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {programs.map((program) => (
                <tr key={program.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">{program.name}</div>
                    <div className="text-xs text-gray-500 truncate max-w-xs">{program.command}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusClass(program.status, program.screenActive)}`}>
                      {getStatusText(program.status, program.screenActive)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {program.screenName || 'N/A'}
                    {program.screenActive && <span className="ml-1 text-green-500">(active)</span>}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {program.pid || 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-1">
                    <button
                      onClick={() => onEdit(program)}
                      className="text-indigo-600 hover:text-indigo-900 px-2 py-1 rounded bg-indigo-50"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleAction('start', program.id)}
                      className="text-green-600 hover:text-green-900 px-2 py-1 rounded bg-green-50"
                      disabled={program.status === 'running'}
                    >
                      Start
                    </button>
                    <button
                      onClick={() => handleAction('stop', program.id)}
                      className="text-yellow-600 hover:text-yellow-900 px-2 py-1 rounded bg-yellow-50"
                      disabled={program.status !== 'running'}
                    >
                      Stop
                    </button>
                    <button
                      onClick={() => handleAction('terminate', program.id)}
                      className="text-red-600 hover:text-red-900 px-2 py-1 rounded bg-red-50"
                      disabled={program.status !== 'running' && !program.screenActive}
                    >
                      Kill
                    </button>
                    <button
                      onClick={() => handleAction('screen', program.id)}
                      className="text-blue-600 hover:text-blue-900 px-2 py-1 rounded bg-blue-50"
                    >
                      Screen
                    </button>
                    <button
                      onClick={() => onTerminal(program)}
                      className="text-purple-600 hover:text-purple-900 px-2 py-1 rounded bg-purple-50"
                      disabled={!program.screenActive}
                    >
                      Terminal
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
