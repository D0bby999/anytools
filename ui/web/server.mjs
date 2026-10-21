/**
 * server.mjs
 * The production web server: react-router-serve's own setup (compression,
 * the hashed assets for a year, public/ for an hour, a log line per request),
 * plus one thing it cannot be told: the app runs behind a proxy that ends TLS
 * (Traefik on anytools.world, nginx in deploy/ for a self-hosted copy).
 *
 * Without `trust proxy`, Express says every request came in over http, and
 * React Router's CSRF check compares the browser's `Origin:
 * https://anytools.world` with `http://anytools.world` and refuses every
 * action with 400. With it, the request's scheme and host are the ones the
 * proxy saw (X-Forwarded-Proto, X-Forwarded-Host). The port is reached only
 * through that proxy: nothing else can set those headers.
 *
 * And one header the build cannot carry: the Python worker's own policy.
 * The worker runs code an exercise brings, which may have been written from
 * a document the learner did not write, and it shares the app's origin. A
 * worker's script response sets its policy: here no eval, and nothing
 * loaded or fetched but the app's own scripts and run-time files, so no
 * import() of a page with the learner's session, and nothing sent away
 * (the private design notes, phase 4; review H1).
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequestHandler } from "@react-router/express";
import compression from "compression";
import express from "express";
import morgan from "morgan";

const build = await import(pathToFileURL(path.resolve("build/server/index.js")).href);
// "build/client", from the working directory, as react-router-serve reads it.
const assets = build.assetsBuildDirectory;
const port = Number(process.env.PORT) || 3000;

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(compression());
const PYTHON_WORKER = /^\/python\.worker-[\w-]+\.js$/;
app.use(path.posix.join(build.publicPath, "assets"), (req, res, next) => {
  if (PYTHON_WORKER.test(req.path)) {
    const origin = `${req.protocol}://${req.get("host")}`;
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; script-src ${origin}/assets/ ${origin}/tool-runtime/ 'wasm-unsafe-eval'; connect-src ${origin}/tool-runtime/`,
    );
  }
  next();
});
app.use(path.posix.join(build.publicPath, "assets"), express.static(path.join(assets, "assets"), { immutable: true, maxAge: "1y" }));
// redirect: false: a folder of static files that shares a page's name
// (public/apps beside the Learning apps page) must not answer /apps with a
// 301 to /apps/; the router has the page.
app.use(build.publicPath, express.static(assets, { redirect: false }));
app.use(express.static("public", { maxAge: "1h", redirect: false }));
app.use(morgan("tiny"));
app.all("*", createRequestHandler({ build, mode: process.env.NODE_ENV }));

const server = process.env.HOST
  ? app.listen(port, process.env.HOST, () => console.log(`[server] http://${process.env.HOST}:${port}`))
  : app.listen(port, () => console.log(`[server] http://localhost:${port}`));
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => server.close(console.error));
