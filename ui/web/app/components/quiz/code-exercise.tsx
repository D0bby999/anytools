/**
 * code-exercise.tsx
 * A code question, answered in place (plans/261020-1535-beyond-english-
 * learning-areas, phase 4; ux/04-code.md): the instructions, the tests'
 * names, an editor with the starting code, "Run the tests" in Python in the
 * browser (lib/python-runner.ts), and the results test by test.
 *
 * Runs are practice: nothing is sent until every test passes, which sends
 * the attempt as passed, or the learner asks to see a solution after a failed
 * run, which sends it as not passed. On a phone the three parts are tabs.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, X } from "lucide-react";
import type { QuestionView } from "~/lib/study-types";
import { testLabel, type RunResult } from "~/lib/python-harness";
import { HARD_STOP_MS, onPythonProgress, pythonReady, runPython, stopPython, warmPython } from "~/lib/python-runner";
import { Button } from "~/components/ui/button";
import { RichText } from "~/components/rich-text";
import { CodeEditor } from "~/components/quiz/code-editor";

/** The tests a file declares, by name (quiz.TestNames). */
export function declaredTests(tests: string): string[] {
  return [...new Set([...tests.matchAll(/^\s*def (test_\w+)\s*\(/gm)].map((m) => m[1]!))];
}

/** Every declared test reported, and passed. */
export function allPassed(run: RunResult, declared: string[]): boolean {
  if (run.error) return false;
  const passed = new Set(run.results.filter((r) => r.passed).map((r) => r.name.slice(r.name.lastIndexOf(".") + 1)));
  return declared.length > 0 && declared.every((n) => passed.has(n));
}

/**
 * The instructions under the card's title: the title line taken off, and the
 * Markdown's own headings ("# Instructions") made h4, under the card's h3.
 */
export function instructions(prompt: string): string {
  return prompt.replace(/^#{1,6} .*\n+/, "").replace(/^#{1,6} /gm, "#### ");
}

type Phase =
  | { kind: "idle" }
  | { kind: "running"; slow: boolean }
  | { kind: "ran"; run: RunResult }
  | { kind: "stopped"; byTimeout: boolean }
  | { kind: "failed" };

const TABS = ["instructions", "code", "tests"] as const;
type Tab = (typeof TABS)[number];

export function CodeExercise({
  question,
  disabled,
  onSubmit,
}: {
  question: QuestionView & { code: NonNullable<QuestionView["code"]> };
  disabled: boolean;
  onSubmit: (code: string, run: RunResult) => void;
}) {
  const { t } = useTranslation("study");
  const ids = useId();
  const { starter, tests, module, credit } = question.code;
  const declared = declaredTests(tests);
  const [code, setCodeState] = useState(starter);
  // What a run reads: the editor's text as of its last keystroke, even before
  // React has rendered it (Ctrl+Enter right after typing).
  const latest = useRef(starter);
  const setCode = (v: string) => {
    latest.current = v;
    setCodeState(v);
  };
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [tab, setTab] = useState<Tab>("instructions");
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    const off = onPythonProgress((loaded, total) => setProgress({ loaded, total }));
    warmPython();
    return () => {
      off();
    };
  }, []);

  useEffect(() => {
    if (phase.kind !== "running" || phase.slow) return;
    const timer = setTimeout(() => setPhase({ kind: "running", slow: true }), 5000);
    return () => clearTimeout(timer);
  }, [phase]);

  const run = async () => {
    if (disabled || phase.kind === "running") return;
    setTab("code");
    setPhase({ kind: "running", slow: false });
    const ran = latest.current;
    const outcome = await runPython(ran, tests, module);
    if (outcome.kind === "result") {
      setPhase({ kind: "ran", run: outcome.result });
      if (allPassed(outcome.result, declared)) onSubmit(ran, outcome.result);
    } else if (outcome.kind === "stopped") {
      setPhase({ kind: "stopped", byTimeout: outcome.byTimeout });
    } else {
      setPhase({ kind: "failed" });
    }
  };

  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
  const loading = progress && !pythonReady() && progress.loaded < progress.total;
  const failedRun = phase.kind === "ran" && !allPassed(phase.run, declared);

  const tabKeys = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.indexOf(tab);
    const next = e.key === "ArrowRight" ? TABS[(i + 1) % TABS.length] : e.key === "ArrowLeft" ? TABS[(i + TABS.length - 1) % TABS.length] : null;
    if (next) {
      e.preventDefault();
      setTab(next);
      document.getElementById(`${ids}-tab-${next}`)?.focus();
    }
  };
  const panel = (name: Tab) => ({
    id: `${ids}-panel-${name}`,
    role: "tabpanel" as const,
    "aria-labelledby": `${ids}-tab-${name}`,
    className: `${tab === name ? "" : "hidden"} lg:block`,
  });

  return (
    <div className="mt-3">
      <div role="tablist" aria-label={t("code.parts")} className="mb-3 flex gap-1 border-b pb-2 lg:hidden">
        {TABS.map((name) => (
          <button
            key={name}
            id={`${ids}-tab-${name}`}
            type="button"
            role="tab"
            aria-selected={tab === name}
            aria-controls={`${ids}-panel-${name}`}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => setTab(name)}
            onKeyDown={tabKeys}
            className={`min-h-11 rounded-md border px-3 text-sm ${
              tab === name ? "border-primary-line bg-selected font-semibold text-selected-foreground" : "border-transparent text-muted-foreground"
            }`}
          >
            {t(`code.tabs.${name}`)}
          </button>
        ))}
      </div>

      <div {...panel("instructions")}>
        <div className="text-sm leading-prose">
          <RichText text={instructions(question.prompt)} sources={[]} />
        </div>
        {credit ? <p className="mt-2 text-xs text-muted-foreground">{credit}</p> : null}
      </div>

      <div {...panel("tests")}>
        <h4 className="mt-4 text-sm font-semibold">{t("code.testsTitle", { count: declared.length })}</h4>
        <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
          {declared.map((n) => (
            <li key={n}>{testLabel(n)}</li>
          ))}
        </ul>
      </div>

      <div {...panel("code")}>
        <label htmlFor={`${ids}-editor`} className="mt-4 block text-sm font-medium">
          {t("code.editor")}
        </label>
        <p id={`${ids}-editor-help`} className="mt-0.5 text-xs text-muted-foreground">
          {t("code.keys")}
        </p>
        <div className="mt-1">
          <CodeEditor
            id={`${ids}-editor`}
            value={code}
            onChange={setCode}
            onRun={() => void run()}
            label={t("code.editor")}
            describedBy={`${ids}-editor-help`}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => void run()} disabled={disabled || phase.kind === "running"}>
            {phase.kind === "running" ? t("code.running") : t("code.run")}
          </Button>
          {phase.kind === "running" && phase.slow ? (
            <Button type="button" variant="outline" onClick={stopPython}>
              {t("code.stop")}
            </Button>
          ) : null}
          {code !== starter && !disabled ? (
            confirmReset ? (
              <>
                <span className="text-sm">{t("code.resetConfirm")}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCode(starter);
                    setConfirmReset(false);
                  }}
                >
                  {t("code.resetYes")}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>
                  {t("code.keep")}
                </Button>
              </>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirmReset(true)}>
                {t("code.reset")}
              </Button>
            )
          ) : null}
        </div>

        <div role="status" className="mt-3 space-y-2 text-sm leading-prose">
          {loading && progress ? (
            <p className="text-muted-foreground">{t("code.loading", { loaded: mb(progress.loaded), total: mb(progress.total) })}</p>
          ) : null}
          {phase.kind === "failed" ? <p className="text-destructive">{t("code.loadFailed")}</p> : null}
          {phase.kind === "stopped" ? (
            <p>{phase.byTimeout ? t("code.timedOut", { seconds: HARD_STOP_MS / 1000 }) : t("code.stopped")}</p>
          ) : null}
          {phase.kind === "ran" ? <Results run={phase.run} declared={declared} /> : null}
        </div>

        {failedRun && !disabled ? (
          <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => onSubmit(latest.current, phase.run)}>
            {t("code.showSolution")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Results({ run, declared }: { run: RunResult; declared: string[] }) {
  const { t } = useTranslation("study");
  if (run.error) {
    return (
      <>
        <p className="flex items-start gap-2 font-medium text-destructive">
          <X aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            {t("code.error")} <code className="font-mono text-xs">{run.error}</code>
          </span>
        </p>
        <Output text={run.output} />
      </>
    );
  }
  const passed = run.results.filter((r) => r.passed).length;
  // Failures first: they are what the learner works on next.
  const ordered = [...run.results].sort((a, b) => Number(a.passed) - Number(b.passed));
  return (
    <>
      <p className="font-medium">{t("code.summary", { passed, total: declared.length || run.results.length })}</p>
      <ul className="space-y-1">
        {ordered.map((r) => (
          <li key={r.name} className="flex items-start gap-2">
            {r.passed ? (
              <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            ) : (
              <X aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
            )}
            <span>
              <span className="sr-only">{r.passed ? t("code.pass") : t("code.fail")}: </span>
              {testLabel(r.name)}
              {r.message ? <code className="mt-0.5 block font-mono text-xs text-muted-foreground">{r.message}</code> : null}
            </span>
          </li>
        ))}
      </ul>
      <Output text={run.output} />
    </>
  );
}

function Output({ text }: { text: string }) {
  const { t } = useTranslation("study");
  if (!text.trim()) return null;
  return (
    <details>
      <summary className="cursor-pointer text-sm text-muted-foreground">{t("code.output")}</summary>
      <pre className="mt-1 overflow-x-auto rounded-md border bg-sunken p-2 font-mono text-xs">{text}</pre>
    </details>
  );
}
