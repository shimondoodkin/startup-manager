"use client";

import React, { useState, useEffect } from 'react';
import { TabInstance } from '@/lib/TabsManager';

import { ProgramState } from '@/lib/Program';
import { useStartupManager } from '@/lib/StartupManagerContext';
import { ProgramList } from './ProgramList';
import { ProgramForm } from './ProgramForm';
import { Terminal } from './Terminal';

export const TabsContainer: React.FC = () => {
  const { terminalManager, tabsManager } = useStartupManager();
  const [tabs, setTabs] = useState<TabInstance[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);



  useEffect(() => {
    // Initial load of tabs
    setTabs(tabsManager.getTabs());
    const activeTab = tabsManager.getActiveTab();
    setActiveTabId(activeTab?.id || null);

    // Subscribe to tab changes
    const handleTabsChanged = () => {
      setTabs(tabsManager.getTabs());
      const activeTab = tabsManager.getActiveTab();
      setActiveTabId(activeTab?.id || null);
    };

    tabsManager.addListener(handleTabsChanged);

    // Cleanup subscription
    return () => {
      tabsManager.removeListener(handleTabsChanged);
    };
  }, []);

  // Handle adding a new program tab
  const handleAddProgram = () => {
    const formTabId = `form-${Date.now()}`;
    tabsManager.addTab({
      id: formTabId,
      type: 'form',
      title: 'Add Program',
      closable: true,
      active: true,
    });
  };

  // Handle editing a program
  const handleEditProgram = (program: ProgramState) => {
    const formTabId = `form-${program.id}-${Date.now()}`;
    tabsManager.addTab({
      id: formTabId,
      type: 'form',
      program,
      title: `Edit ${program.name}`,
      closable: true,
      active: true,
    });
  };

  // Only request the terminal from the server; tab creation is handled elsewhere (e.g., listener/effect)
  const handleOpenTerminal = async (program: ProgramState) => {
    if (!program.screenName) return;
    try {
      await terminalManager.createTerminalOnServer(program.screenName);
    } catch (err) {
      console.error('Failed to open terminal for program:', err);
    }
  };

  // Only request the terminal from the server; tab creation is handled elsewhere (e.g., listener/effect)
  const handleOpenTerminalTab = async () => {
    try {
      console.log('Requesting new terminal...');
      await terminalManager.createTerminalOnServer();
      console.log('Terminal created, synced, and tabs updated.');
    } catch (err) {
      console.error('Failed to open terminal:', err);
    }
  };

  // Handle closing a tab
  const handleCloseTab = async (id: string) => {
    // Get the tab before closing it
    const tab = tabs.find(tab => tab.id === id);

    // Close the tab in TabsManager
    tabsManager.closeTab(id);

    // If this was a terminal tab, handle terminal closing
    if (tab?.type === 'terminal' && tab.terminalInstance) {
      console.log(`Closing terminal with id: ${tab.terminalInstance.id}`);
      // Close the terminal in terminalManager
      await terminalManager.closeTerminal(tab.terminalInstance.id);
      console.log('Terminal closed, synced, and tabs updated.');
    }
  };



  // Handle activating a tab
  const handleActivateTab = (id: string) => {
    tabsManager.setActiveTab(id);
  };

  // Handle saving a program
  const handleSaveProgram = () => {
    // Find and close the form tab
    const formTab = tabs.find(tab => tab.type === 'form');
    if (formTab) {
      tabsManager.closeTab(formTab.id);
    }

    // Activate the list tab
    const listTab = tabs.find(tab => tab.type === 'list');
    if (listTab) {
      tabsManager.setActiveTab(listTab.id);
    }
  };

  // Handle canceling program edit
  const handleCancelEdit = () => {
    // Find and close the form tab
    const formTab = tabs.find(tab => tab.type === 'form');
    if (formTab) {
      tabsManager.closeTab(formTab.id);
    }

    // Activate the list tab
    const listTab = tabs.find(tab => tab.type === 'list');
    if (listTab) {
      tabsManager.setActiveTab(listTab.id);
    }
  };

  // Render the appropriate content for the active tab
  const renderTabContent = (tab: TabInstance) => {

    if (tab.type === 'list') {
      return (
        <div>
          <div className="mb-4 flex justify-end space-x-4">
            <button
              onClick={handleOpenTerminalTab}
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
      );
    }

    if (tab.type === 'form') {
      return (
        <ProgramForm
          program={tab.program}
          onCancel={handleCancelEdit}
          onSave={handleSaveProgram}
        />
      );
    }

    if (tab.type === 'terminal') {
      return (
        <Terminal
          onClose={() => handleCloseTab(tab.id)}
          terminalInstance={tab.terminalInstance}
        />
      );
    }

    return <div>Unknown tab type</div>;
  };

  // Render the active tab content
  const renderActiveTabContent = () => {
    const activeTab = tabs.find(tab => tab.active);
    if (!activeTab) return null;

    return renderTabContent(activeTab);
  };

  // Get WebSocket context outside of the effect
  const webSocketContext = useStartupManager();
  const { client, isAuthenticated } = webSocketContext;

  // Automatically create/remove terminal tabs in response to server terminal list changes
  useEffect(() => {
    if (!client || !isAuthenticated) return;

    // Handler for server event
    const handleTerminalListChanged = async () => {
      await terminalManager.updateTerminalInstancesFromServer();
    };

    // Listen for terminalListChanged event
    client.on('terminalListChanged', handleTerminalListChanged);

    // Initial sync
    handleTerminalListChanged();

    // Cleanup
    return () => {
      client.off('terminalListChanged', handleTerminalListChanged);
    };
  }, [client, isAuthenticated, terminalManager]);

  return (
    <div className="flex flex-col h-full">
      {/* Tab headers */}
      <div className="flex border-b border-gray-200 overflow-x-auto">
        {tabs.map((tab: TabInstance) => (
          <div
            key={tab.id}
            className={`px-4 py-2 cursor-pointer flex items-center whitespace-nowrap ${tab.active
                ? 'border-b-2 border-indigo-500 text-indigo-600'
                : 'text-gray-600 hover:text-gray-800'
              }`}
            onClick={() => handleActivateTab(tab.id)}
          >
            <span>{tab.title}</span>
            {tab.closable && (
              <button
                className="ml-2 text-gray-400 hover:text-gray-600"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseTab(tab.id);
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
        {renderActiveTabContent()}
      </div>
    </div>
  );
};
