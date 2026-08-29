'use client';
import { Card, CardContent, CardHeader, CardTitle, CopyButton, Input, PrivacyNote } from '@anytools/ui';
import { useState } from 'react';
import {
  type ChmodState,
  DEFAULT_STATE,
  chmodCommand,
  octalToState,
  stateToOctal,
  stateToSymbolic,
  symbolicToState,
} from './logic';

const WHO = ['owner', 'group', 'others'] as const;
const PERMS = ['read', 'write', 'execute'] as const;

export function ChmodCalculatorUi() {
  const [state, setState] = useState<ChmodState>(DEFAULT_STATE);
  // Text drafts let users type freely; state only updates on valid input.
  const [octalDraft, setOctalDraft] = useState(stateToOctal(DEFAULT_STATE));
  const [symbolicDraft, setSymbolicDraft] = useState(stateToSymbolic(DEFAULT_STATE));

  const applyState = (next: ChmodState) => {
    setState(next);
    setOctalDraft(stateToOctal(next));
    setSymbolicDraft(stateToSymbolic(next));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Chmod Calculator</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Who</th>
                {PERMS.map((perm) => (
                  <th key={perm} className="py-2 px-3 font-medium capitalize">
                    {perm}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {WHO.map((who) => (
                <tr key={who}>
                  <td className="py-2 pr-4 capitalize font-medium">{who}</td>
                  {PERMS.map((perm) => (
                    <td key={perm} className="py-2 px-3">
                      <input
                        type="checkbox"
                        checked={state[who][perm]}
                        onChange={(e) =>
                          applyState({
                            ...state,
                            [who]: { ...state[who], [perm]: e.target.checked },
                          })
                        }
                        aria-label={`${who} ${perm}`}
                        className="h-4 w-4 accent-[var(--color-accent)]"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap gap-4 text-sm">
          {(['setuid', 'setgid', 'sticky'] as const).map((bit) => (
            <label key={bit} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={state[bit]}
                onChange={(e) => applyState({ ...state, [bit]: e.target.checked })}
                className="h-4 w-4 accent-[var(--color-accent)]"
              />
              {bit}
            </label>
          ))}
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <span className="block text-sm font-medium mb-1.5">Octal</span>
            <Input
              value={octalDraft}
              onChange={(e) => {
                setOctalDraft(e.target.value);
                const parsed = octalToState(e.target.value);
                if (parsed) {
                  setState(parsed);
                  setSymbolicDraft(stateToSymbolic(parsed));
                }
              }}
              aria-label="Octal permissions"
              aria-invalid={octalToState(octalDraft) === null}
              className="h-11 font-mono text-lg"
            />
          </div>
          <div>
            <span className="block text-sm font-medium mb-1.5">Symbolic</span>
            <Input
              value={symbolicDraft}
              onChange={(e) => {
                setSymbolicDraft(e.target.value);
                const parsed = symbolicToState(e.target.value);
                if (parsed) {
                  setState(parsed);
                  setOctalDraft(stateToOctal(parsed));
                }
              }}
              aria-label="Symbolic permissions"
              aria-invalid={symbolicToState(symbolicDraft) === null}
              className="h-11 font-mono text-lg"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-lg border p-3">
          <code className="font-mono text-sm flex-1">{chmodCommand(state)}</code>
          <CopyButton text={chmodCommand(state)} />
        </div>
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
