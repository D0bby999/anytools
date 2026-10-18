/**
 * The messages between the page and validator-worker.ts, and the worker's side of them.
 *
 * ajv turns a schema into a function with `new Function`. This app's CSP gives the page no
 * 'unsafe-eval' (lib/security-headers.server.ts), so on the page `compile` throws. A dedicated
 * worker loaded from its own same-origin script takes its policy from that script's response,
 * and the static asset server sends none with it, so ajv runs there unmodified while the page
 * keeps a policy without eval. Nothing in the worker touches the DOM or the session.
 *
 * A ToolError does not survive structured cloning as a ToolError, so the worker sends its code,
 * message and params, and validator-client.ts builds the ToolError again.
 */
import { ToolError } from '../shared/tool-error';
import { type SchemaDraft, type ValidationResult, validateAgainstSchema } from './logic';

export type ValidateRequest = { id: number; schemaText: string; dataText: string; draft: SchemaDraft };

export type ValidateResponse =
  | { id: number; ok: true; result: ValidationResult }
  | {
      id: number;
      ok: false;
      error: { message: string; code?: string; params?: Record<string, string | number> };
    };

export async function answer(request: ValidateRequest): Promise<ValidateResponse> {
  const { id, schemaText, dataText, draft } = request;
  try {
    return { id, ok: true, result: await validateAgainstSchema(schemaText, dataText, draft) };
  } catch (e) {
    if (e instanceof ToolError) {
      return { id, ok: false, error: { message: e.message, code: e.code, params: e.params } };
    }
    return { id, ok: false, error: { message: e instanceof Error ? e.message : String(e) } };
  }
}

/** The error validateAgainstSchema threw, rebuilt on the page's side. */
export function reviveError(error: Extract<ValidateResponse, { ok: false }>['error']): Error {
  return error.code ? new ToolError(error.code, error.message, error.params) : new Error(error.message);
}
