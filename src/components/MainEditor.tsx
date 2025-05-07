"use client";

import React, { useState } from 'react';
import { ProgramState } from '@/lib/Program';
import { ProgramList } from './ProgramList';
import { ProgramForm } from './ProgramForm';
import { Terminal } from './Terminal';

type TabType = 'list' | 'form' | { type: 'terminal', program: ProgramState } | { type: 'standalone-terminal' };

export const MainEditor: React.FC = () => {
  const [tabs, setTabs] = useState<TabType[]>(['list']);
  const [activeTab, setActiveTab] = useState<number>(0);
  const [editingProgram, setEditingProgram] = useState<ProgramState | undefined>(undefined);
  
  const handleAddProgram = () => {
    setEditingProgram(undefined);
    setTabs([...tabs, 'form']);
    setActiveTab(tabs.length);
  };
  
  const handleEditProgram = (program: ProgramState) => {
    setEditingProgram(program);
    setTabs([...tabs, 'form']);
    setActiveTab(tabs.length);
  };
  
  const handleOpenTerminal = (program: ProgramState) => {
    const terminalTab = { type: 'terminal' as const, program };
    setTabs([...tabs, terminalTab]);
    setActiveTab(tabs.length);
  };
  
  const handleOpenStandaloneTerminal = () => {
    const terminalTab = { type: 'standalone-terminal' as const };
    setTabs([...tabs, terminalTab]);
    setActiveTab(tabs.length);
  };
  
  const handleCloseTab = (index: number) => {
    if (index === 0) return; // Don't close the main list tab
    
    // Get the tab that's being closed
    const tabToClose = tabs[index];
    
    // Filter out the closed tab
    const newTabs = tabs.filter((_, i) => i !== index);
    setTabs(newTabs);
    
    // If the active tab was closed, activate the previous tab
    if (activeTab === index) {
      setActiveTab(Math.max(0, index - 1));
    } 
    // If the active tab was after the closed tab, adjust its index
    else if (activeTab > index) {
      setActiveTab(activeTab - 1);
    }
  };
  
  const handleSaveProgram = () => {
    setTabs(tabs.filter((tab) => tab !== 'form'));
    setActiveTab(0); // Go back to the list tab
  };
  
  const handleCancelEdit = () => {
    setTabs(tabs.filter((tab) => tab !== 'form'));
    setActiveTab(0); // Go back to the list tab
  };
  
  const getTabTitle = (tab: TabType, index: number) => {
    if (tab === 'list') return 'Programs';
    if (tab === 'form') return editingProgram ? `Edit ${editingProgram.name}` : 'Add Program';
    if (typeof tab === 'object' && tab.type === 'terminal') {
      return `Terminal: ${tab.program.name}`;
    }
    if (typeof tab === 'object' && tab.type === 'standalone-terminal') {
      return 'Terminal';
    }
    return `Tab ${index}`;
  };
  
  return (
    <div className="flex flex-col h-full">
      {/* Tab headers */}
      <div className="flex border-b border-gray-200">
        {tabs.map((tab, index) => (
          <div 
            key={index}
            className={`px-4 py-2 cursor-pointer flex items-center ${
              index === activeTab 
                ? 'border-b-2 border-indigo-500 text-indigo-600' 
                : 'text-gray-600 hover:text-gray-800'
            }`}
            onClick={() => setActiveTab(index)}
          >
            <span>{getTabTitle(tab, index)}</span>
            {index > 0 && (
              <button
                className="ml-2 text-gray-400 hover:text-gray-600"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseTab(index);
                }}
              >
                &times;
              </button>
            )}
          </div>
        ))}
      </div>
      
      {/* Tab content */}
      <div className="flex-grow overflow-auto p-4">
        {tabs[activeTab] === 'list' && (
          <div>
            <div className="mb-4 flex justify-end space-x-4">
              <button
                onClick={handleOpenStandaloneTerminal}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
              >
                Open Terminal
              </button>
              <button
                onClick={handleAddProgram}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Add Program
              </button>
            </div>
            <ProgramList 
              onEdit={handleEditProgram}
              onTerminal={handleOpenTerminal}
            />
          </div>
        )}
        
        {tabs[activeTab] === 'form' && (
          <ProgramForm
            program={editingProgram}
            onCancel={handleCancelEdit}
            onSave={handleSaveProgram}
          />
        )}
        
        {typeof tabs[activeTab] === 'object' && tabs[activeTab].type === 'terminal' && (
          <Terminal
            program={(tabs[activeTab] as { type: 'terminal', program: ProgramState }).program}
            onClose={() => handleCloseTab(activeTab)}
          />
        )}
        
        {typeof tabs[activeTab] === 'object' && tabs[activeTab].type === 'standalone-terminal' && (
          <Terminal
            standalone={true}
            onClose={() => handleCloseTab(activeTab)}
          />
        )}
      </div>
    </div>
  );
};
