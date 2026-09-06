/**
 * `@peculiar/x509` depends on `tsyringe`, which throws at *import* time ("tsyringe requires a
 * reflect polyfill") unless `Reflect.getMetadata` already exists — normally supplied by the
 * `reflect-metadata` package. That package is not in this repo's lockfile: it is only a
 * devDependency of tsyringe itself (used for tsyringe's own tests), not a runtime dependency,
 * so nothing pulls it in transitively. Rather than add a new dependency, this defines the two
 * calls tsyringe's `@injectable()` decorator actually makes (`getMetadata`/`getOwnMetadata`,
 * both allowed to return `undefined` — verified by reading tsyringe's `reflection-helpers.js`).
 * This is safe because `./logic.ts` never uses tsyringe's DI container — `X509Certificate` is
 * constructed directly — and a real `reflect-metadata` polyfill would still take priority if
 * one is ever added for another tool (the early-return below checks for it first).
 */
export function ensureReflectMetadataStub(): void {
  const r = Reflect as unknown as Record<string, unknown>;
  if (typeof r.getMetadata === 'function') return; // a real polyfill is already loaded
  const store = new WeakMap<object, Map<string, unknown>>();
  const get = (key: string, target: object) => store.get(target)?.get(key);
  const define = (key: string, value: unknown, target: object) => {
    if (!store.has(target)) store.set(target, new Map());
    store.get(target)?.set(key, value);
  };
  r.getMetadata = get;
  r.getOwnMetadata = get;
  r.defineMetadata = define;
  r.metadata = (key: string, value: unknown) => (target: object) => define(key, value, target);
}
