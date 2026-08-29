import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATE,
  chmodCommand,
  octalToState,
  stateToOctal,
  stateToSymbolic,
  symbolicToState,
} from './logic';

describe('stateToOctal / stateToSymbolic', () => {
  it('renders 754 default as rwxr-xr--', () => {
    expect(stateToOctal(DEFAULT_STATE)).toBe('754');
    expect(stateToSymbolic(DEFAULT_STATE)).toBe('rwxr-xr--');
  });

  it('renders special bits with 4-digit octal and s/t markers', () => {
    const state = octalToState('4755');
    expect(state).not.toBeNull();
    expect(stateToOctal(state as never)).toBe('4755');
    expect(stateToSymbolic(state as never)).toBe('rwsr-xr-x');
  });

  it('renders S/T (uppercase) when special bit set without execute', () => {
    const state = octalToState('1644');
    expect(stateToSymbolic(state as never)).toBe('rw-r--r-T');
    const setuidNoExec = octalToState('4644');
    expect(stateToSymbolic(setuidNoExec as never)).toBe('rwSr--r--');
  });
});

describe('octalToState', () => {
  it('roundtrips common modes', () => {
    for (const mode of ['777', '755', '644', '600', '000', '2755', '1777']) {
      const state = octalToState(mode);
      expect(state, mode).not.toBeNull();
      expect(stateToOctal(state as never)).toBe(mode);
    }
  });
  it('rejects invalid input', () => {
    expect(octalToState('88')).toBeNull();
    expect(octalToState('12345')).toBeNull();
    expect(octalToState('7a5')).toBeNull();
  });
});

describe('symbolicToState', () => {
  it('roundtrips symbolic notation', () => {
    for (const sym of ['rwxr-xr-x', 'rw-r--r--', 'rwsr-xr-x', 'rwxrwxrwt', '---------']) {
      const state = symbolicToState(sym);
      expect(state, sym).not.toBeNull();
      expect(stateToSymbolic(state as never)).toBe(sym);
    }
  });
  it('rejects malformed strings', () => {
    expect(symbolicToState('rwx')).toBeNull();
    expect(symbolicToState('rwxrwxrwq')).toBeNull();
    // 's' only valid in execute position of owner/group; 't' only in others.
    expect(symbolicToState('rwxrwxrws')).toBeNull();
  });
});

describe('chmodCommand', () => {
  it('builds the shell command', () => {
    expect(chmodCommand(DEFAULT_STATE, 'script.sh')).toBe('chmod 754 script.sh');
  });
});
