/**
 * entry.server.tsx
 * React Router's default Node entry, plus two things phase 11 needs on every
 * HTML document: a per-request CSP nonce, and the security headers
 * (security-headers.server.ts). Documents and data also say no shared cache
 * may keep them, and a signed-in visitor's response sets their session cookie
 * again so none does (session.server.ts, resendSession).
 *
 * The nonce goes three places: the CSP header, React's own streaming inline
 * scripts (`nonce` on renderToPipeableStream and ServerRouter), and root.tsx's
 * Scripts / ScrollRestoration / theme script, through NonceContext.
 */
import { randomBytes } from "node:crypto";
import { PassThrough } from "node:stream";

import type { AppLoadContext, EntryContext } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { ServerRouter } from "react-router";
import { isbot } from "isbot";
import type { RenderToPipeableStreamOptions } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";
import { NonceContext } from "~/lib/nonce";
import { applyCachePolicy, applySecurityHeaders } from "~/lib/security-headers.server";
import { resendSession } from "~/lib/session.server";

export const streamTimeout = 5_000;

/**
 * Client navigation's data (`*.data`) follows the documents' cache policy and
 * carries a signed-in visitor's session again (resendSession). A copy, since
 * a response's own headers may be immutable.
 */
export async function handleDataRequest(response: Response, { request }: { request: Request }): Promise<Response> {
  const out = new Response(response.body, response);
  applyCachePolicy(out.headers);
  await resendSession(request, out.headers);
  return out;
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: AppLoadContext,
) {
  const nonce = randomBytes(16).toString("base64");
  applySecurityHeaders(responseHeaders, nonce, process.env.NODE_ENV === "production");
  await resendSession(request, responseHeaders);

  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, { status: responseStatusCode, headers: responseHeaders });
  }

  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get("user-agent");

    // Bots and SPA mode wait for all content, so crawlers get the full page.
    const readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? "onAllReady" : "onShellReady";

    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => abort(), streamTimeout + 1000);

    const { pipe, abort } = renderToPipeableStream(
      <NonceContext.Provider value={nonce}>
        <ServerRouter context={routerContext} url={request.url} nonce={nonce} />
      </NonceContext.Provider>,
      {
        nonce,
        [readyOption]() {
          shellRendered = true;
          const body = new PassThrough({
            final(callback) {
              clearTimeout(timeoutId);
              timeoutId = undefined;
              callback();
            },
          });
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          pipe(body);
          resolve(new Response(stream, { headers: responseHeaders, status: responseStatusCode }));
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          // Errors during the shell are logged by handleDocumentRequest.
          if (shellRendered) console.error(error);
        },
      },
    );
  });
}
