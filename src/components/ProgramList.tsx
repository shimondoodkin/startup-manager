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
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

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
    setActiveMenu(null); // Close menu after action
  };

  const toggleMenu = (programId: string) => {
    setActiveMenu(activeMenu === programId ? null : programId);
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
          {/* Desktop view - Table */}
          <div className="hidden md:block">
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
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                      <button
                        onClick={() => handleAction('start', program.id)}
                        className="text-green-600 hover:text-green-900 px-2 py-1 rounded bg-green-50 inline-flex items-center"
                        disabled={program.status === 'running'}
                      >
                        <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                        </svg>
                        Start
                      </button>
                      <button
                        onClick={() => handleAction('stop', program.id)}
                        className="text-yellow-600 hover:text-yellow-900 px-2 py-1 rounded bg-yellow-50 inline-flex items-center"
                        disabled={program.status !== 'running'}
                      >
                        <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                        </svg>
                        Stop
                      </button>
                      <button
                        onClick={() => onTerminal(program)}
                        className="text-purple-600 hover:text-purple-900 px-2 py-1 rounded bg-purple-50 inline-flex items-center"
                        disabled={!program.screenActive}
                      >
                        <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                          <path fillRule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V5zm11 1H6v8l4-2 4 2V6z" clipRule="evenodd" />
                        </svg>
                        Terminal
                      </button>
                      <div className="relative inline-block text-left">
                        <button
                          id={`dropdown-anchor-${program.id}`}
                          onClick={() => toggleMenu(program.id)}
                          className="text-gray-600 hover:text-gray-900 px-2 py-1 rounded bg-gray-50 inline-flex items-center"
                        >
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                          </svg>
                        </button>
                        {activeMenu === program.id && (
                          <div className="fixed inset-0 z-50 overflow-hidden" onClick={() => setActiveMenu(null)}>
                            <div className="absolute inset-0 overflow-hidden">
                              <div className="absolute inset-0 bg-transparent" onClick={() => setActiveMenu(null)}></div>
                              <div 
                                className="absolute w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50"
                                style={{
                                  top: `${(document.getElementById(`dropdown-anchor-${program.id}`)?.getBoundingClientRect().bottom || 0) + 5}px`,
                                  right: `${window.innerWidth - (document.getElementById(`dropdown-anchor-${program.id}`)?.getBoundingClientRect().right || 0)}px`
                                }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="py-1" role="menu" aria-orientation="vertical">
                                  <button
                                    onClick={() => onEdit(program)}
                                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => handleAction('terminate', program.id)}
                                    className="block w-full text-left px-4 py-2 text-sm text-red-700 hover:bg-gray-100"
                                    disabled={program.status !== 'running' && !program.screenActive}
                                  >
                                    Kill
                                  </button>
                                  <button
                                    onClick={() => handleAction('screen', program.id)}
                                    className="block w-full text-left px-4 py-2 text-sm text-blue-700 hover:bg-gray-100"
                                  >
                                    Screen
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Mobile view - Cards */}
          <div className="md:hidden">
            <ul className="divide-y divide-gray-200">
              {programs.map((program) => (
                <li key={program.id} className="py-4 px-4">
                  <div className="flex flex-col space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="text-sm font-medium">{program.name}</h3>
                        <p className="text-xs text-gray-500 truncate max-w-[200px]">{program.command}</p>
                      </div>
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusClass(program.status, program.screenActive)}`}>
                        {getStatusText(program.status, program.screenActive)}
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                      <div>
                        <span className="font-medium">Screen:</span> {program.screenName || 'N/A'}
                        {program.screenActive && <span className="ml-1 text-green-500">(active)</span>}
                      </div>
                      <div>
                        <span className="font-medium">PID:</span> {program.pid || 'N/A'}
                      </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-2 mt-2">
                      <button
                        onClick={() => handleAction('start', program.id)}
                        className="text-green-600 hover:text-green-900 px-2 py-1 rounded bg-green-50 inline-flex items-center text-xs"
                        disabled={program.status === 'running'}
                      >
                        <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                        </svg>
                        Start
                      </button>
                      <button
                        onClick={() => handleAction('stop', program.id)}
                        className="text-yellow-600 hover:text-yellow-900 px-2 py-1 rounded bg-yellow-50 inline-flex items-center text-xs"
                        disabled={program.status !== 'running'}
                      >
                        <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                        </svg>
                        Stop
                      </button>
                      <button
                        onClick={() => onTerminal(program)}
                        className="text-purple-600 hover:text-purple-900 px-2 py-1 rounded bg-purple-50 inline-flex items-center text-xs"
                        disabled={!program.screenActive}
                      >
                        <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                          <path fillRule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V5zm11 1H6v8l4-2 4 2V6z" clipRule="evenodd" />
                        </svg>
                        Terminal
                      </button>
                      <div className="relative inline-block text-left">
                        <button
                          id={`dropdown-anchor-mobile-${program.id}`}
                          onClick={() => toggleMenu(program.id)}
                          className="text-gray-600 hover:text-gray-900 px-2 py-1 rounded bg-gray-50 inline-flex items-center text-xs"
                        >
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                          </svg>
                          More
                        </button>
                        {activeMenu === program.id && (
                          <div className="fixed inset-0 z-50 overflow-hidden" onClick={() => setActiveMenu(null)}>
                            <div className="absolute inset-0 overflow-hidden">
                              <div className="absolute inset-0 bg-transparent" onClick={() => setActiveMenu(null)}></div>
                              <div 
                                className="absolute w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50"
                                style={{
                                  top: `${(document.getElementById(`dropdown-anchor-mobile-${program.id}`)?.getBoundingClientRect().bottom || 0) + 5}px`,
                                  right: `${window.innerWidth - (document.getElementById(`dropdown-anchor-mobile-${program.id}`)?.getBoundingClientRect().right || 0)}px`
                                }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="py-1" role="menu" aria-orientation="vertical">
                                  <button
                                    onClick={() => onEdit(program)}
                                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => handleAction('terminate', program.id)}
                                    className="block w-full text-left px-4 py-2 text-sm text-red-700 hover:bg-gray-100"
                                    disabled={program.status !== 'running' && !program.screenActive}
                                  >
                                    Kill
                                  </button>
                                  <button
                                    onClick={() => handleAction('screen', program.id)}
                                    className="block w-full text-left px-4 py-2 text-sm text-blue-700 hover:bg-gray-100"
                                  >
                                    Screen
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};
