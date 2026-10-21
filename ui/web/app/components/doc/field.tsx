import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";

/**
 * One input or select (I4), drawn like VitePress's search box: a 40px box with
 * a hairline that turns to the action ink on hover and focus, its label above
 * at 14/500 and its hint below at 13px. The label, hint and error are tied to
 * the control by id, so it is announced with them.
 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** The one control: an <input>, a <select> or a <textarea>. */
  children: ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>;
}) {
  const base = useId();
  const controlId = (isValidElement(children) && children.props.id) || `${base}-control`;
  const hintId = hint ? `${base}-hint` : undefined;
  const errorId = error ? `${base}-error` : undefined;
  const describedBy = [children.props["aria-describedby"], hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="lp-field">
      <label className="lp-field-label" htmlFor={controlId}>
        {label}
      </label>
      <div className="lp-field-box">
        {cloneElement(children, {
          id: controlId,
          "aria-describedby": describedBy,
          "aria-invalid": error ? true : children.props["aria-invalid"],
        })}
      </div>
      {hint ? (
        <p id={hintId} className="lp-field-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="lp-field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
