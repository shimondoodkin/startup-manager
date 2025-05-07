import { Program, ProgramConfig } from './Program';
import * as childProcess from 'child_process';
import treeKill from 'tree-kill';

// Mock the dependencies
jest.mock('child_process', () => ({
  spawn: jest.fn(),
  exec: jest.fn((cmd, cb) => {
    if (cmd.includes('screen -list')) {
      cb(null, 'test-screen');
    } else {
      cb(null, '');
    }
    return { unref: jest.fn() };
  })
}));

jest.mock('tree-kill', () => jest.fn((pid, signal, cb) => cb(null)));
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid')
}));

describe('Program', () => {
  let program: Program;
  const mockConfig: ProgramConfig = {
    id: 'test-id',
    name: 'Test Program',
    command: 'echo "Hello World"',
    screenName: 'test-screen',
    maxChildDepth: 1,
    autoStart: false
  };

  beforeEach(() => {
    jest.clearAllMocks();
    program = new Program(mockConfig, './config.json');
  });

  describe('constructor', () => {
    it('should initialize with provided config', () => {
      expect(program.id).toBe('test-id');
      expect(program.name).toBe('Test Program');
      expect(program.command).toBe('echo "Hello World"');
      expect(program.screenName).toBe('test-screen');
      expect(program.maxChildDepth).toBe(1);
      expect(program.autoStart).toBe(false);
      
      // This would fail if tests weren't actually running
      expect(1 + 1).toBe(2);
    });

    it('should generate id if not provided', () => {
      const programWithoutId = new Program({
        ...mockConfig,
        id: undefined as unknown as string
      }, './config.json');
      expect(programWithoutId.id).toBe('mock-uuid');
    });

    it('should use default values for optional properties', () => {
      const programWithDefaults = new Program({
        id: 'test-id',
        name: 'Test Program',
        command: 'echo "Hello World"',
        screenName: 'test-screen',
        maxChildDepth: undefined as unknown as number,
        autoStart: undefined as unknown as boolean
      }, './config.json');
      expect(programWithDefaults.maxChildDepth).toBe(1);
      expect(programWithDefaults.autoStart).toBe(false);
    });
  });

  describe('getState', () => {
    it('should return the current state of the program', () => {
      const state = program.getState();
      expect(state).toEqual({
        id: 'test-id',
        name: 'Test Program',
        command: 'echo "Hello World"',
        screenName: 'test-screen',
        maxChildDepth: 1,
        autoStart: false,
        pid: undefined,
        status: 'stopped',
        screenActive: false
      });
    });
  });

  describe('setStatusChangeCallback', () => {
    it('should set the status change callback', () => {
      const callback = jest.fn();
      program.setStatusChangeCallback(callback);
      
      // Access private property for testing
      const privateProgram = program as any;
      expect(privateProgram.statusChangeCallback).toBe(callback);
    });
  });

  describe('startScreen', () => {
    it('should start a new screen session', async () => {
      const result = await program.startScreen();
      expect(result).toBe(true);
      expect(childProcess.exec).toHaveBeenCalledWith(
        'screen -dmS test-screen',
        expect.any(Function)
      );
    });
  });

  describe('sendCommandToScreen', () => {
    it('should send a command to the screen session', async () => {
      // First create a screen session
      await program.startScreen();
      
      // Then send a command to it
      const result = await program.sendCommandToScreen('test command');
      
      expect(result).toBe(true);
      // Use a more flexible matcher to avoid issues with escape sequences
      expect(childProcess.exec).toHaveBeenCalledWith(
        expect.stringContaining('screen -S test-screen -X stuff'),
        expect.any(Function)
      );
    });
  });

  describe('start', () => {
    it('should start the program in a screen session', async () => {
      // Mock the methods used by start
      jest.spyOn(program, 'runInScreen').mockResolvedValue(true);
      jest.spyOn(program as any, 'findProcessPid').mockResolvedValue(12345);

      const result = await program.start();
      
      expect(result).toBe(true);
      
      // Check if status was updated
      expect(program.getState().status).toBe('running');
    });

    it('should handle errors when starting the program', async () => {
      // Mock console.error to prevent error output in test results
      const originalConsoleError = console.error;
      console.error = jest.fn();
      
      jest.spyOn(program, 'runInScreen').mockRejectedValue(new Error('Failed to run'));

      const result = await program.start();
      
      expect(result).toBe(false);
      expect(program.getState().status).toBe('error');
      
      // Restore console.error
      console.error = originalConsoleError;
    });
  });

  describe('stop', () => {
    it('should stop the program', async () => {
      // Set up a PID for the program
      (program as any).pid = 12345;
      
      // Mock process.kill
      const originalKill = process.kill;
      process.kill = jest.fn();
      
      const result = await program.stop();
      
      expect(result).toBe(true);
      expect(process.kill).toHaveBeenCalledWith(12345, 'SIGINT');
      expect(program.getState().status).toBe('stopped');
      expect(program.getState().pid).toBeUndefined();
      
      // Restore original function
      process.kill = originalKill;
    });

    it('should return false if no PID is set', async () => {
      const result = await program.stop();
      expect(result).toBe(false);
    });
  });

  describe('terminate', () => {
    it('should terminate the program and its child processes', async () => {
      // Set up a PID for the program
      (program as any).pid = 12345;
      
      const result = await program.terminate();
      
      expect(result).toBe(true);
      expect(treeKill).toHaveBeenCalledWith(12345, 'SIGKILL', expect.any(Function));
      expect(program.getState().status).toBe('stopped');
      expect(program.getState().pid).toBeUndefined();
    });

    it('should return false if no PID is set', async () => {
      const result = await program.terminate();
      expect(result).toBe(false);
    });
  });
});
