/**
 * code-editor.tsx
 * The code exercise's editor (the private design notes, phase 4): CodeMirror 6 (MIT) with Python, loaded on the first code
 * question, in the app's mono face and its ink and paper in both themes.
 * Until it loads, and if it cannot, a plain textarea holds the code.
 *
 * Tab indents; Escape then Tab leaves the editor (CodeMirror's own rule,
 * said under it). Ctrl+Enter or Cmd+Enter runs the tests.
 */
import { useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";

export function CodeEditor({
  id,
  value,
  onChange,
  onRun,
  label,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
  label: string;
  describedBy?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [ready, setReady] = useState(false);
  const latest = useRef({ onChange, onRun });
  latest.current = { onChange, onRun };
  // The text as it is now, not as it was on the first render: the learner
  // may type in the plain box before CodeMirror has loaded.
  const current = useRef(value);
  current.current = value;
  const plain = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import("codemirror"),
      import("@codemirror/lang-python"),
      import("@codemirror/view"),
      import("@codemirror/commands"),
      import("@codemirror/language"),
      import("@lezer/highlight"),
    ])
      .then(([{ basicSetup, EditorView: View }, { python }, { keymap }, { indentWithTab }, { HighlightStyle, syntaxHighlighting, indentUnit }, { tags }]) => {
        if (cancelled || !host.current) return;
        const theme = View.theme({
          "&": { backgroundColor: "var(--color-card)", color: "var(--color-foreground)", fontSize: "14px" },
          ".cm-content": { fontFamily: "var(--font-mono)", caretColor: "var(--color-primary)" },
          ".cm-gutters": { backgroundColor: "var(--color-card)", color: "var(--color-muted-foreground)", border: "none" },
          ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--color-hover)" },
          // The focus ring is the frame's (focus-within), as a button's: an
          // outline here is clipped by the frame, or covered by the gutter.
          "&.cm-focused": { outline: "none" },
          ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "var(--color-selected)" },
        });
        // The app's own ink, readable in both themes: keywords in the action
        // ink, comments muted; CodeMirror's default colours are light-only.
        const highlight = HighlightStyle.define([
          { tag: [tags.keyword, tags.definitionKeyword, tags.controlKeyword, tags.operatorKeyword], color: "var(--color-primary)", fontWeight: "600" },
          { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--color-muted-foreground)", fontStyle: "italic" },
          { tag: [tags.string, tags.number, tags.bool, tags.null], color: "var(--color-foreground)", textDecoration: "underline dotted" },
          { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: "var(--color-foreground)", fontWeight: "600" },
        ]);
        view.current = new View({
          doc: current.current,
          parent: host.current,
          extensions: [
            // Before basicSetup: the first keymap wins, and basicSetup's
            // Mod-Enter inserts a blank line. Ctrl-Enter too on a Mac, as the
            // hint says, where Mod is Cmd.
            keymap.of([
              { key: "Mod-Enter", run: () => (latest.current.onRun(), true) },
              { key: "Ctrl-Enter", run: () => (latest.current.onRun(), true) },
              indentWithTab,
            ]),
            basicSetup,
            python(),
            // Four spaces, as PEP 8 and every exercise's own code.
            indentUnit.of("    "),
            theme,
            syntaxHighlighting(highlight, { fallback: false }),
            View.updateListener.of((u) => {
              if (u.docChanged) latest.current.onChange(u.state.doc.toString());
            }),
            View.contentAttributes.of({
              "aria-label": label,
              ...(describedBy ? { "aria-describedby": describedBy } : {}),
              id,
            }),
          ],
        });
        // Typing goes on in the editor where it was going on in the box.
        const typing = document.activeElement === plain.current;
        setReady(true);
        if (typing) view.current?.focus();
      })
      .catch(() => undefined); // The textarea stays, and works.
    return () => {
      cancelled = true;
      view.current?.destroy();
      view.current = null;
    };
    // The editor is made once; its document then follows the learner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset replaces the document from outside.
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  return (
    <>
      {ready ? null : (
        <textarea
          ref={plain}
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              onRun();
            }
          }}
          rows={12}
          spellCheck={false}
          aria-describedby={describedBy}
          className="w-full rounded-md border border-control-border bg-card p-3 font-mono text-sm text-foreground"
        />
      )}
      <div ref={host} hidden={!ready} className="overflow-hidden rounded-md border border-control-border focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 focus-within:ring-offset-background" />
    </>
  );
}
