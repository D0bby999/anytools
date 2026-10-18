/**
 * The page's side of validator-worker.ts: one worker per mounted tool, created on first use and
 * terminated by `dispose`. Each call carries an id, so an answer for an older edit resolves only
 * its own promise.
 *
 * Without Worker (tests, the server render) or when the worker fails to start, validation runs
 * on the page instead. Under the production CSP that path cannot compile a schema, and says so
 * through the usual schemaCompileError; it exists so the tool degrades rather than hangs.
 */
import { type SchemaDraft, type ValidationResult, validateAgainstSchema } from './logic';
import { type ValidateRequest, type ValidateResponse, reviveError } from './validator-protocol';

export type SchemaValidator = {
  validate(schemaText: string, dataText: string, draft: SchemaDraft): Promise<ValidationResult>;
  dispose(): void;
};

type Pending = {
  request: ValidateRequest;
  resolve: (r: ValidationResult) => void;
  reject: (e: Error) => void;
};

export function createSchemaValidator(): SchemaValidator {
  let worker: Worker | null = null;
  let broken = typeof Worker === 'undefined';
  let nextId = 0;
  const pending = new Map<number, Pending>();

  const onPage = (r: ValidateRequest) => validateAgainstSchema(r.schemaText, r.dataText, r.draft);

  const start = (): Worker | null => {
    if (worker || broken) return worker;
    try {
      worker = new Worker(new URL('./validator-worker.ts', import.meta.url), { type: 'module' });
    } catch {
      broken = true;
      return null;
    }
    worker.onmessage = (e: MessageEvent<ValidateResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(reviveError(e.data.error));
    };
    worker.onerror = () => {
      broken = true;
      worker?.terminate();
      worker = null;
      for (const [id, p] of pending) {
        pending.delete(id);
        onPage(p.request).then(p.resolve, p.reject);
      }
    };
    return worker;
  };

  return {
    validate(schemaText, dataText, draft) {
      const request: ValidateRequest = { id: ++nextId, schemaText, dataText, draft };
      const w = start();
      if (!w) return onPage(request);
      return new Promise((resolve, reject) => {
        pending.set(request.id, { request, resolve, reject });
        w.postMessage(request);
      });
    },
    dispose() {
      worker?.terminate();
      worker = null;
      pending.clear();
    },
  };
}
