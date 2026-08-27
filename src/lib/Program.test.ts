import { Program, ProgramConfig, isIdleShell } from './Program';

// In-memory fake of the tmux wrapper: one "server" shared by all tests.
type FakeSession = { foreground: string; pid: number; typed: string[]; ctrlC: number };
const sessions = new Map<string, FakeSession>();
let nextPid = 1000;

const fakeTmux = {
  validateSessionName: jest.fn(),
  hasSession: jest.fn(async (n: string) => sessions.has(n)),
  newSession: jest.fn(async (n: string) => {
    sessions.set(n, { foreground: 'bash', pid: nextPid++, typed: [], ctrlC: 0 });
    return true;
  }),
  sendKeys: jest.fn(async (n: string, text: string) => {
    const s = sessions.get(n);
    if (!s) return false;
    s.typed.push(text);
    s.foreground = text.split(' ')[0]; // pretend the command is now running
    return true;
  }),
  sendCtrlC: jest.fn(async (n: string) => {
    const s = sessions.get(n);
    if (!s) return false;
    s.ctrlC++;
    s.foreground = 'bash';
    return true;
  }),
  killSession: jest.fn(async (n: string) => sessions.delete(n)),
  paneInfo: jest.fn(async (n: string) => {
    const s = sessions.get(n);
    return s ? { pid: s.pid, currentCommand: s.foreground } : undefined;
  }),
  capturePane: jest.fn(async (n: string) => (sessions.has(n) ? 'some output\n' : undefined)),
};

jest.mock('./tmux', () => ({ getTmux: () => fakeTmux, Tmux: jest.fn() }));
jest.mock('tree-kill', () => jest.fn((pid, signal, cb) => cb(null)));
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));
jest.mock('./logger', () => ({ __esModule: true, default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() } }));

// Speed up the stop/start polling delays.
jest.spyOn(global, 'setTimeout').mockImplementation(((fn: any) => { fn(); return 0 as any; }) as any);

describe('isIdleShell', () => {
  it('recognises idle shells', () => {
    expect(isIdleShell('bash')).toBe(true);
    expect(isIdleShell('bash.exe')).toBe(true);
    expect(isIdleShell('python')).toBe(false);
    expect(isIdleShell('powershell.exe')).toBe(false);
  });
});

describe('Program', () => {
  let program: Program;
  const mockConfig: ProgramConfig = {
    id: 'test-id',
    name: 'Test Program',
    command: 'python job.py',
    screenName: 'test-session',
    maxChildDepth: 1,
    autoStart: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    sessions.clear();
    program = new Program(mockConfig, './config.json');
  });

  describe('constructor', () => {
    it('initialises from config', () => {
      expect(program.id).toBe('test-id');
      expect(program.screenName).toBe('test-session');
      expect(program.stopMethod).toBe('SIGHUP');
    });

    it('generates an id if not provided', () => {
      const p = new Program({ ...mockConfig, id: undefined as unknown as string }, './config.json');
      expect(p.id).toBe('mock-uuid');
    });
  });

  describe('getState', () => {
    it('starts stopped with no session', () => {
      expect(program.getState()).toMatchObject({ status: 'stopped', screenActive: false, pid: undefined });
    });
  });

  describe('startScreen', () => {
    it('creates a detached session', async () => {
      expect(await program.startScreen()).toBe(true);
      expect(fakeTmux.newSession).toHaveBeenCalledWith('test-session');
      expect(program.getState().screenActive).toBe(true);
    });

    it('reuses an existing session', async () => {
      sessions.set('test-session', { foreground: 'bash', pid: 1, typed: [], ctrlC: 0 });
      expect(await program.startScreen()).toBe(true);
      expect(fakeTmux.newSession).not.toHaveBeenCalled();
    });

    it('notifies on screenActive change', async () => {
      const cb = jest.fn();
      program.setStatusChangeCallback(cb);
      await program.startScreen();
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ screenActive: true }));
    });
  });

  describe('start', () => {
    it('creates the session, types the command and reports running', async () => {
      expect(await program.start()).toBe(true);
      expect(sessions.get('test-session')!.typed).toEqual(['python job.py']);
      expect(program.getState()).toMatchObject({ status: 'running', screenActive: true, foregroundCommand: 'python' });
      expect(program.getState().pid).toBeDefined();
    });

    it('does not retype the command if already running', async () => {
      await program.start();
      await program.start();
      expect(sessions.get('test-session')!.typed).toHaveLength(1);
    });

    it('reports error state when tmux throws', async () => {
      fakeTmux.hasSession.mockRejectedValueOnce(new Error('boom'));
      expect(await program.start()).toBe(false);
      expect(program.getState().status).toBe('error');
    });
  });

  describe('stop', () => {
    it('sends Ctrl+C and waits for the foreground program to exit', async () => {
      program.stopMethod = 'CTRL_C';
      await program.start();
      expect(await program.stop()).toBe(true);
      expect(sessions.get('test-session')!.ctrlC).toBe(1);
      expect(program.getState()).toMatchObject({ status: 'stopped', pid: undefined, screenActive: true });
    });

    it('returns false when there is no session', async () => {
      program.stopMethod = 'CTRL_C';
      expect(await program.stop()).toBe(false);
    });

    it('falls back to Ctrl+C on Windows regardless of stopMethod', async () => {
      const orig = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });
      try {
        program.stopMethod = 'SIGINT';
        await program.start();
        expect(await program.stop()).toBe(true);
        expect(sessions.get('test-session')!.ctrlC).toBe(1);
      } finally {
        Object.defineProperty(process, 'platform', { value: orig });
      }
    });

    it('reports failure if the program keeps running', async () => {
      program.stopMethod = 'CTRL_C';
      await program.start();
      fakeTmux.sendCtrlC.mockImplementationOnce(async () => true); // ignored Ctrl+C
      expect(await program.stop()).toBe(false);
      expect(program.getState().status).toBe('running');
    });
  });

  describe('terminate', () => {
    it('kills the session', async () => {
      await program.start();
      expect(await program.terminate()).toBe(true);
      expect(fakeTmux.killSession).toHaveBeenCalledWith('test-session');
      expect(program.getState()).toMatchObject({ status: 'stopped', screenActive: false, pid: undefined });
    });

    it('succeeds (no-op) when there is no session', async () => {
      expect(await program.terminate()).toBe(true);
      expect(fakeTmux.killSession).not.toHaveBeenCalled();
    });
  });

  describe('monitor', () => {
    it('detects the program finishing on its own', async () => {
      const cb = jest.fn();
      program.setStatusChangeCallback(cb);
      await program.start();
      sessions.get('test-session')!.foreground = 'bash';
      await program.monitor();
      expect(program.getState().status).toBe('stopped');
      expect(cb).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'stopped' }));
    });

    it('detects the session disappearing', async () => {
      await program.start();
      sessions.clear();
      await program.monitor();
      expect(program.getState()).toMatchObject({ status: 'stopped', screenActive: false });
    });

    it('adopts a session started outside the manager', async () => {
      sessions.set('test-session', { foreground: 'python', pid: 7, typed: [], ctrlC: 0 });
      await program.monitor();
      expect(program.getState()).toMatchObject({ status: 'running', pid: 7, screenActive: true });
    });
  });

  describe('getOutput', () => {
    it('returns the captured pane', async () => {
      await program.start();
      expect(await program.getOutput(50)).toBe('some output\n');
      expect(fakeTmux.capturePane).toHaveBeenCalledWith('test-session', 50);
    });

    it('returns undefined without a session', async () => {
      expect(await program.getOutput()).toBeUndefined();
    });
  });
});
