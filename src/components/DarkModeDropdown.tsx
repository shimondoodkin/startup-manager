"use client";

import React from 'react';
import { ProgramState } from '@/lib/Program';

interface DarkModeDropdownProps {
  program: ProgramState;
  onClose: () => void;
  onEdit: (program: ProgramState) => void;
  onAction: (action: string, programId: string) => void;
  visible: boolean;
  anchorId: string;
}

export const DarkModeDropdown: React.FC<DarkModeDropdownProps> = ({ 
  program, 
  onClose, 
  onEdit, 
  onAction, 
  visible, 
  anchorId 
}) => {
  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden" onClick={onClose}>
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-transparent" onClick={onClose}></div>
        <div 
          className="absolute w-48 rounded-md shadow-lg z-50"
          style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--border-color)',
            top: `${(document.getElementById(anchorId)?.getBoundingClientRect().bottom || 0) + 5}px`,
            right: `${window.innerWidth - (document.getElementById(anchorId)?.getBoundingClientRect().right || 0)}px`
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="py-1" role="menu" aria-orientation="vertical">
            <button
              onClick={() => onEdit(program)}
              className="block w-full text-left px-4 py-2 text-sm hover:opacity-80"
              style={{ color: 'var(--foreground)', background: 'var(--card-bg)' }}
            >
              Edit
            </button>
            <button
              onClick={() => onAction('terminate', program.id)}
              className="block w-full text-left px-4 py-2 text-sm hover:opacity-80"
              style={{ color: '#ef4444', background: 'var(--card-bg)' }}
              disabled={program.status !== 'running' && !program.screenActive}
            >
              Kill
            </button>
            <button
              onClick={() => onAction('screen', program.id)}
              className="block w-full text-left px-4 py-2 text-sm hover:opacity-80"
              style={{ color: '#3b82f6', background: 'var(--card-bg)' }}
            >
              Screen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
