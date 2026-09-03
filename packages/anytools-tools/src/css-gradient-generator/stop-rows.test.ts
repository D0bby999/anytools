import { describe, expect, it } from 'vitest';
import type { GradientState } from './logic';
import {
  type GradientEditorState,
  appendRow,
  makeRows,
  removeRow,
  switchKind,
  updateRow,
  withRowIds,
} from './stop-rows';

const linear: GradientState = {
  kind: 'linear',
  angle: 90,
  repeating: false,
  stops: [
    { color: '#FFFFFF', position: 0 },
    { color: '#000000', position: 100 },
  ],
};

describe('makeRows / withRowIds', () => {
  it('gives every row its own id', () => {
    const rows = makeRows(linear.stops);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  it('never repeats an id across separate lists', () => {
    const ids = [...makeRows(linear.stops), ...makeRows(linear.stops)].map((r) => r.id);
    expect(new Set(ids).size).toBe(4);
  });

  it('keeps the colour and position of every stop', () => {
    expect(withRowIds(linear).stops.map(({ color, position }) => ({ color, position }))).toEqual(
      linear.stops,
    );
  });
});

describe('updateRow', () => {
  // This is the keystroke bug in one assertion: the row used to be keyed by its colour,
  // so every character typed produced a new key, React remounted the input and the
  // field lost focus after one character. The id has to survive the edit.
  it('keeps the id while the colour changes character by character', () => {
    let rows = makeRows(linear.stops);
    const id = rows[0]?.id;
    for (const partial of ['h', 'hs', 'hsl', 'hsl(280, 90%, 55%)']) {
      rows = updateRow(rows, 0, { color: partial });
      expect(rows[0]?.id).toBe(id);
    }
    expect(rows[0]?.color).toBe('hsl(280, 90%, 55%)');
  });

  it('keeps the id while the position is dragged', () => {
    const rows = makeRows(linear.stops);
    expect(updateRow(rows, 1, { position: 62.5 })[1]).toEqual({ ...rows[1], position: 62.5 });
  });

  it('touches no other row', () => {
    const rows = makeRows(linear.stops);
    expect(updateRow(rows, 0, { color: 'red' })[1]).toBe(rows[1]);
  });

  it('ignores an index that does not exist', () => {
    const rows = makeRows(linear.stops);
    expect(updateRow(rows, 9, { color: 'red' })).toEqual(rows);
  });
});

describe('appendRow / removeRow', () => {
  it('gives the new row an id no other row has', () => {
    const rows = appendRow(makeRows(linear.stops), { color: '#FFFFFF', position: 100 });
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
  });

  it('drops one row and leaves the others with their ids — so focus does not jump', () => {
    const rows = appendRow(makeRows(linear.stops), { color: 'red', position: 50 });
    const after = removeRow(rows, 0);
    expect(after.map((r) => r.id)).toEqual([rows[1]?.id, rows[2]?.id]);
  });
});

describe('switchKind', () => {
  it('carries the same rows, ids included, into the new gradient kind', () => {
    const editor = withRowIds(linear);
    const conic = switchKind(editor, 'conic') as GradientEditorState;
    expect(conic.kind).toBe('conic');
    expect(conic.stops).toEqual(editor.stops);
  });
});
