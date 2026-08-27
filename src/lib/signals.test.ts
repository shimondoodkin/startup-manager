import { execFile } from 'child_process';
import * as fs from 'fs';
import { foregroundProcessGroup, parseTpgidFromStat, signalForeground } from './signals';

jest.mock('child_process', () => ({ execFile: jest.fn() }));
jest.mock('fs', () => ({ readFileSync: jest.fn() }));
jest.mock('./logger', () => ({ __esModule: true, default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() } }));

const readFileSync = fs.readFileSync as jest.Mock;
const execFileMock = execFile as unknown as jest.Mock;

/** Make `ps -o tpgid=` answer with `out`, or fail when out is undefined. */
function psReturns(out: string | undefined) {
  execFileMock.mockImplementation((_bin: string, _args: string[], _opts: any, cb: any) =>
    out === undefined ? cb(new Error('no ps'), '', '') : cb(null, out, ''));
}

const withPlatform = (value: string, fn: () => void | Promise<void>) => {
  const orig = process.platform;
  Object.defineProperty(process, 'platform', { value, configurable: true });
  return Promise.resolve(fn())
    .finally(() => Object.defineProperty(process, 'platform', { value: orig, configurable: true }));
};

// These describe Linux behaviour, so pretend to be Linux wherever the suite runs.
let realPlatform: PropertyDescriptor | undefined;
beforeEach(() => {
  jest.clearAllMocks();
  readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
  psReturns(undefined);
  realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
});
afterEach(() => {
  if (realPlatform) Object.defineProperty(process, 'platform', realPlatform);
});

describe('parseTpgidFromStat', () => {
  it('reads field 8', () => {
    expect(parseTpgidFromStat('1234 (bash) S 1200 1234 1234 34816 4321 4194304 ...')).toBe(4321);
  });

  it('survives a comm containing spaces and parentheses', () => {
    expect(parseTpgidFromStat('99 (my prog (x)) S 1 99 99 34816 777 0')).toBe(777);
  });

  it('returns undefined for junk', () => {
    expect(parseTpgidFromStat('not a stat line')).toBeUndefined();
  });
});

describe('foregroundProcessGroup', () => {
  it('prefers /proc on Linux', async () => {
    readFileSync.mockReturnValue('1234 (bash) S 1200 1234 1234 34816 4321 4194304');
    await expect(foregroundProcessGroup(1234)).resolves.toBe(4321);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('falls back to ps when /proc is unavailable', async () => {
    psReturns(' 4321\n');
    await expect(foregroundProcessGroup(1234)).resolves.toBe(4321);
    expect(execFileMock.mock.calls[0][1]).toEqual(['-o', 'tpgid=', '-p', '1234']);
  });

  it('treats tpgid -1 (no foreground group) as unknown', async () => {
    readFileSync.mockReturnValue('1234 (bash) S 1200 1234 1234 0 -1 4194304');
    await expect(foregroundProcessGroup(1234)).resolves.toBeUndefined();
  });

  it('returns undefined on Windows without touching /proc or ps', async () => {
    await withPlatform('win32', async () => {
      await expect(foregroundProcessGroup(1234)).resolves.toBeUndefined();
      expect(readFileSync).not.toHaveBeenCalled();
      expect(execFileMock).not.toHaveBeenCalled();
    });
  });

  it('rejects nonsense pids', async () => {
    await expect(foregroundProcessGroup(0)).resolves.toBeUndefined();
    await expect(foregroundProcessGroup(-5)).resolves.toBeUndefined();
  });
});

describe('signalForeground', () => {
  let kill: jest.SpyInstance;
  beforeEach(() => { kill = jest.spyOn(process, 'kill').mockImplementation(() => true); });
  afterEach(() => kill.mockRestore());

  it('signals the whole foreground group, not the pane shell', async () => {
    readFileSync.mockReturnValue('1234 (bash) S 1200 1234 1234 34816 4321 0');
    await expect(signalForeground(1234, 'SIGINT')).resolves.toBe('process group 4321');
    expect(kill).toHaveBeenCalledWith(-4321, 'SIGINT');
  });

  it('falls back to the pane shell when the group is unknown', async () => {
    await expect(signalForeground(1234, 'SIGHUP')).resolves.toBe('pid 1234');
    expect(kill).toHaveBeenCalledWith(1234, 'SIGHUP');
  });
});
