/**
 * Identity for the stop rows in the editor.
 *
 * React needs a key that survives an edit. Keying a row by `stop.color` (what this tool
 * shipped with) remounts the whole row on every keystroke, so the colour field loses
 * focus after one character and `hsl(280, 90%, 55%)` can never be typed. The index is
 * no good either: removing a stop or inserting one would shift every key below it and
 * move the focus and the caret to a different row.
 *
 * So each row carries an id that is created once and copied through every edit. The id
 * lives here and not in `ColorStop`, because `ColorStop` is the CSS value model and the
 * round-trip test compares parsed states by deep equality — a generated id would never
 * survive `parse(toCss(s))`.
 */
import { type ColorStop, type GradientKind, type GradientState, withKind } from './logic';

export type StopRow = ColorStop & { id: string };

/** The gradient state as the editor holds it: same value model, rows instead of stops. */
export type GradientEditorState = GradientState extends infer T
  ? T extends GradientState
    ? Omit<T, 'stops'> & { stops: StopRow[] }
    : never
  : never;

let counter = 0;

/** Ids only have to be unique inside one list; a module counter is enough for that. */
export function makeRow(stop: ColorStop): StopRow {
  counter += 1;
  return { ...stop, id: `stop-${counter}` };
}

export function makeRows(stops: readonly ColorStop[]): StopRow[] {
  return stops.map(makeRow);
}

/** Attach fresh ids — for a preset, or for CSS that was just pasted in. */
export function withRowIds(g: GradientState): GradientEditorState {
  return { ...g, stops: makeRows(g.stops) };
}

/** Edit one row in place. The id is kept, which is the whole point of this module. */
export function updateRow(rows: StopRow[], index: number, patch: Partial<ColorStop>): StopRow[] {
  return rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
}

export function appendRow(rows: StopRow[], stop: ColorStop): StopRow[] {
  return [...rows, makeRow(stop)];
}

export function removeRow(rows: StopRow[], index: number): StopRow[] {
  return rows.filter((_, i) => i !== index);
}

/** Change gradient kind without disturbing the rows — `withKind` carries them through. */
export function switchKind(g: GradientEditorState, kind: GradientKind): GradientEditorState {
  return { ...withKind(g, kind), stops: g.stops };
}
