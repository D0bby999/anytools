'use client';
import { Button, SegmentedControl } from '@anytools/ui';
import { useEffect, useRef, useState } from 'react';
import { DURATIONS, LABELS, type Phase, fmtSeconds, phaseProgress } from './logic';

// iOS Safari only allows AudioContext.start() inside a user gesture. We create
// the context on the first Start click, store it in a ref, and resume() it
// before each chime so the timer-tick callback (not a gesture) can still play.
function makeAudioContext(): AudioContext | null {
  try {
    const Ctx =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    return new Ctx();
  } catch {
    return null;
  }
}

function chime(ctx: AudioContext | null) {
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 440;
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.setValueAtTime(0.3, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  } catch {
    // AudioContext throw — silent fail
  }
}

export function PomodoroTimerUi() {
  const [phase, setPhase] = useState<Phase>('focus');
  const [remaining, setRemaining] = useState(DURATIONS.focus);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(0);
  const timerRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!running) return;
    timerRef.current = window.setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          chime(audioCtxRef.current);
          setRunning(false);
          if (phase === 'focus') setCompleted((c) => c + 1);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, [running, phase]);

  const handleStartPause = () => {
    // Pre-warm AudioContext on user gesture — iOS Safari requires it.
    if (!audioCtxRef.current) audioCtxRef.current = makeAudioContext();
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    setRunning((r) => !r);
  };

  const switchPhase = (next: Phase) => {
    setPhase(next);
    setRemaining(DURATIONS[next]);
    setRunning(false);
  };

  const pct = phaseProgress(phase, remaining);

  return (
    <div className="space-y-6 max-w-md mx-auto">
      <header className="text-center">
        <h2 className="text-2xl font-semibold mb-1">Pomodoro Timer</h2>
        <p className="text-sm text-muted-foreground">25 / 5 / 15 minute blocks.</p>
      </header>
      <SegmentedControl
        value={phase}
        onChange={switchPhase}
        options={[
          { value: 'focus', label: 'Focus (25)' },
          { value: 'short', label: 'Short (5)' },
          { value: 'long', label: 'Long (15)' },
        ]}
        label="Mode"
      />
      <div className="rounded-lg border bg-card p-8 text-center">
        <div className="text-7xl font-bold tabular-nums tracking-tight" aria-live="polite">
          {fmtSeconds(remaining)}
        </div>
        <p className="text-sm text-muted-foreground mt-2">{LABELS[phase]}</p>
        <div className="mt-4 h-2 rounded-full bg-muted overflow-hidden" aria-hidden="true">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="lg"
          onClick={handleStartPause}
          className="h-12"
          disabled={remaining === 0 && !running}
        >
          {running ? 'Pause' : remaining === 0 ? 'Done' : 'Start'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => {
            setRunning(false);
            setRemaining(DURATIONS[phase]);
          }}
          className="h-12"
        >
          Reset
        </Button>
      </div>
      <p className="text-center text-sm text-muted-foreground">
        Completed focus blocks today: <span className="font-semibold">{completed}</span>
      </p>
    </div>
  );
}
