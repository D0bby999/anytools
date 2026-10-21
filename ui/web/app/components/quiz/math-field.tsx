/**
 * math-field.tsx
 * The answer box of a question whose answer is maths
 * (the private design notes, phase 2; ux/02-maths.md).
 *
 * It starts as a plain text box, which works before any script and if
 * MathLive cannot load, and becomes a MathLive field once the library has
 * loaded (a separate chunk, fetched on the first maths question; its fonts
 * from /tool-runtime/). What is posted is the field's ASCII-math, the
 * notation the Go checker reads, so the stored answer reads like what was
 * typed. MathLive only edits: the marking is the server's.
 */
import { useEffect, useRef, useState } from "react";
import type { MathfieldElement } from "mathlive";

const FONTS = "/tool-runtime/mathlive@0.111.1/fonts";

export function MathField({
  id,
  name,
  label,
  describedBy,
  className,
}: {
  id: string;
  name: string;
  /** The visible label's text: the field is labelled by it for screen readers. */
  label: string;
  describedBy?: string;
  className: string;
}) {
  const [value, setValue] = useState("");
  const [ready, setReady] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const field = useRef<MathfieldElement | null>(null);
  const typed = useRef("");
  typed.current = value;

  useEffect(() => {
    let cancelled = false;
    import("mathlive")
      .then(({ MathfieldElement }) => {
        if (cancelled || !holder.current) return;
        MathfieldElement.fontsDirectory = FONTS;
        MathfieldElement.soundsDirectory = null;
        const mf = new MathfieldElement();
        mf.id = id;
        mf.setAttribute("aria-label", label);
        if (describedBy) mf.setAttribute("aria-describedby", describedBy);
        mf.className = className;
        mf.mathVirtualKeyboardPolicy = "auto";
        mf.smartFence = true;
        // What was typed in the plain box comes along.
        mf.value = typed.current;
        mf.addEventListener("input", () => setValue(mf.getValue("ascii-math")));
        mf.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            mf.closest("form")?.requestSubmit();
          }
        });
        holder.current.replaceChildren(mf);
        // Only a mounted field takes a menu.
        mf.menuItems = [];
        field.current = mf;
        setReady(true);
      })
      .catch(() => undefined); // The plain box stays, and works.
    return () => {
      cancelled = true;
    };
  }, [id, label, describedBy, className]);

  // A hidden input cannot be `required`: an empty field keeps the form from
  // being sent, as the plain box does.
  useEffect(() => {
    const form = holder.current?.closest("form");
    if (!ready || !form) return;
    const guard = (e: Event) => {
      if (!field.current?.getValue("ascii-math").trim()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        field.current?.focus();
      }
    };
    form.addEventListener("submit", guard, true);
    return () => form.removeEventListener("submit", guard, true);
  }, [ready]);

  // The host is empty to React: MathLive's element lives in it, and React
  // never renders a child there it would later try to remove.
  return (
    <>
      {ready ? (
        <input type="hidden" name={name} value={value} />
      ) : (
        <input
          id={id}
          name={name}
          required
          maxLength={4000}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-describedby={describedBy}
          className={`mt-1 ${className}`}
        />
      )}
      <div ref={holder} hidden={!ready} className="mt-1" />
    </>
  );
}
