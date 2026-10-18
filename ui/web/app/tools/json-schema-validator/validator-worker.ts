/**
 * Runs INSIDE a dedicated worker, built by Vite from `new Worker(new URL(...))` in
 * validator-client.ts. Why ajv runs here and not on the page: validator-protocol.ts.
 */
import { type ValidateRequest, answer } from './validator-protocol';

self.onmessage = async (e: MessageEvent<ValidateRequest>) => {
  postMessage(await answer(e.data));
};
