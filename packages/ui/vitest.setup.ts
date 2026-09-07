import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// happy-dom keeps one document across a file's tests; without this a component mounted in one
// test is still in the DOM for the next, and `getByRole` throws "found multiple elements".
afterEach(cleanup);

/*
 * DOM APIs happy-dom does not implement, which Radix's popper-backed components call
 * unconditionally. Without these, `Select` throws "target.hasPointerCapture is not a function"
 * on the click that should open it and no listbox is ever rendered — the component is fine,
 * the environment is short a few methods.
 *
 * Polyfilling the gap is deliberate, and different from asserting behaviour the environment
 * cannot produce: these stand in for real browser APIs so the component's own logic runs.
 * Where no such stand-in exists — arrow-key movement inside a radio group, see
 * radio-group.test.tsx — the assertion is dropped and moved to a browser smoke check rather
 * than faked.
 */
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
