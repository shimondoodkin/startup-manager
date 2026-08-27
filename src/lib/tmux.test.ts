import { Tmux, toCygwinPath } from './tmux';

// Mock execFile so no real tmux is needed.
jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

jest.mock('./logger', () => ({ __esModule: true, default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() } }));

import { execFile } from 'child_process';
const execFileMock = execFile as unknown as jest.Mock;

function mockResult(stdout: string, error: Error | null = null) {
  execFileMock.mockImplementationOnce((_bin: string, _args: string[], _opts: any, cb: any) => {
    cb(error, stdout, '');
  });
}

describe('Tmux', () => {
  let tmux: Tmux;

  beforeEach(() => {
    execFileMock.mockReset();
    tmux = new Tmux('tmux');
  });

  it('uses the configured binary path', async () => {
    const custom = new Tmux('C:/tools/tmux.exe');
    mockResult('');
    await custom.hasSession('x');
    expect(execFileMock.mock.calls[0][0]).toBe('C:/tools/tmux.exe');
  });

  it('hasSession returns true when tmux exits 0', async () => {
    mockResult('');
    await expect(tmux.hasSession('abc')).resolves.toBe(true);
    expect(execFileMock.mock.calls[0][1]).toEqual(['has-session', '-t', '=abc']);
  });

  it('hasSession returns false when tmux exits non-zero', async () => {
    mockResult('', new Error("can't find session"));
    await expect(tmux.hasSession('abc')).resolves.toBe(false);
  });

  it('newSession creates a detached session with the platform shell', async () => {
    mockResult('');
    const t = new Tmux('C:/tools/itmux/bin/tmux.exe');
    const shell = t.sessionShell();
    await expect(t.newSession('abc')).resolves.toBe(true);
    expect(execFileMock.mock.calls[0][1]).toEqual(['new-session', '-d', '-s', 'abc', ...(shell ? [shell] : [])]);
  });

  it('sessionShell uses the bundled bash.exe on Windows, TMUX_SHELL when set', () => {
    const orig = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      expect(new Tmux('C:\\tools\\itmux\\bin\\tmux.exe').sessionShell()).toBe('/cygdrive/c/tools/itmux/bin/bash.exe --norc -i');
      process.env.TMUX_SHELL = 'zsh';
      expect(new Tmux('tmux').sessionShell()).toBe('zsh');
    } finally {
      delete process.env.TMUX_SHELL;
      Object.defineProperty(process, 'platform', { value: orig });
    }
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try { expect(new Tmux('tmux').sessionShell()).toBeUndefined(); }
    finally { Object.defineProperty(process, 'platform', { value: orig }); }
  });

  it('puts the bundle bin dir on PATH for the session shell on Windows', async () => {
    const orig = process.platform;
    const origPath = process.env.PATH;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.PATH = 'C:\\Windows\\System32';
    try {
      mockResult('');
      await new Tmux('C:\\tools\\itmux\\bin\\tmux.exe').newSession('abc');
      // bash.exe --norc inherits this verbatim, so date/sleep/grep must be on it.
      expect(execFileMock.mock.calls[0][2].env.PATH).toBe('C:\\tools\\itmux\\bin;C:\\Windows\\System32');
    } finally {
      process.env.PATH = origPath;
      Object.defineProperty(process, 'platform', { value: orig });
    }
  });

  it('inherits the environment unchanged off Windows', async () => {
    const orig = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      mockResult('');
      await new Tmux('tmux').newSession('abc');
      expect(execFileMock.mock.calls[0][2].env).toBeUndefined();
    } finally {
      Object.defineProperty(process, 'platform', { value: orig });
    }
  });

  it('toCygwinPath converts drive paths', () => {
    expect(toCygwinPath('C:\\a\\b.exe')).toBe('/cygdrive/c/a/b.exe');
    expect(toCygwinPath('D:/x/y')).toBe('/cygdrive/d/x/y');
    expect(toCygwinPath('/usr/bin/bash')).toBe('/usr/bin/bash');
  });

  it('sendKeys passes the text literally and presses Enter', async () => {
    mockResult('');
    await tmux.sendKeys('abc', 'echo "hi"');
    expect(execFileMock.mock.calls[0][1]).toEqual(['send-keys', '-t', '=abc:', '-l', 'echo "hi"']);
    mockResult('');
    mockResult('');
    await tmux.sendKeys('abc', 'echo "hi"', true);
    expect(execFileMock.mock.calls[1][1]).toEqual(['send-keys', '-t', '=abc:', '-l', 'echo "hi"']);
    expect(execFileMock.mock.calls[2][1]).toEqual(['send-keys', '-t', '=abc:', 'Enter']);
  });

  it('sendCtrlC sends the C-c key name', async () => {
    mockResult('');
    await tmux.sendCtrlC('abc');
    expect(execFileMock.mock.calls[0][1]).toEqual(['send-keys', '-t', '=abc:', 'C-c']);
  });

  it('killSession kills the named session', async () => {
    mockResult('');
    await expect(tmux.killSession('abc')).resolves.toBe(true);
    expect(execFileMock.mock.calls[0][1]).toEqual(['kill-session', '-t', '=abc']);
  });

  it('paneInfo parses pid and current command', async () => {
    mockResult('1234 bash\n');
    await expect(tmux.paneInfo('abc')).resolves.toEqual({ pid: 1234, currentCommand: 'bash' });
    expect(execFileMock.mock.calls[0][1]).toEqual([
      'display-message', '-p', '-t', '=abc:', '#{pane_pid} #{pane_current_command}',
    ]);
  });

  it('paneInfo returns undefined when the session is gone', async () => {
    mockResult('', new Error("can't find session"));
    await expect(tmux.paneInfo('abc')).resolves.toBeUndefined();
  });

  it('capturePane returns the last N lines of scrollback', async () => {
    mockResult('line1\nline2\n');
    await expect(tmux.capturePane('abc', 500)).resolves.toBe('line1\nline2\n');
    expect(execFileMock.mock.calls[0][1]).toEqual([
      'capture-pane', '-p', '-t', '=abc:', '-S', '-500', '-E', '-',
    ]);
  });

  it('rejects session names that tmux would mangle', () => {
    expect(() => tmux.validateSessionName('a.b')).toThrow();
    expect(() => tmux.validateSessionName('a:b')).toThrow();
    expect(() => tmux.validateSessionName('')).toThrow();
    expect(() => tmux.validateSessionName('ok-name_1')).not.toThrow();
  });
});
