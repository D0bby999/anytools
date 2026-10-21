/**
 * stage-tool-runtime.mjs
 * Puts the files tools load by URL at run time (wasm, models, language data,
 * fonts) into ui/web/tool-runtime/<name>@<version>/, from the manifest
 * scripts/tool-runtime.json. routes/tool-runtime.$.ts serves them with a
 * year-long immutable cache, which is safe because the version is in the path.
 *
 * Two kinds of entry:
 *  - `package`: copied out of node_modules. The version in the folder name
 *    must equal the installed package's, or staging fails, so upgrading a
 *    package without moving its URL (and the loader that names it) cannot
 *    ship a stale file under an immutable URL. `via` resolves a package that
 *    is only a dependency of another (tesseract.js-core, through tesseract.js).
 *  - `download`: fetched from an immutable URL (a tag, a commit or a release)
 *    and checked against a pinned sha256. A mismatch fails the build. A file
 *    already staged with the right hash is not fetched again. A download
 *    with `extract` is a zip: it is kept in node_modules/.cache by its hash,
 *    and only its files under `prefix` whose names match `match` are staged
 *    (Ultimate Geography's flags and maps, not the rest of its release).
 *    With `flatten`, a match may be one folder deep, staged as
 *    "<folder>-<file>" (free-exercise-db's "<exercise>/0.jpg").
 *
 * An entry with `precompress` also gets a brotli copy (`<file>.br`, quality
 * 11) of each script, wasm and JSON file of 64 KB or more, which the route
 * sends to a browser that accepts br instead of compressing on every
 * request. Quality 11 takes half a minute for Python's 9.6 MB wasm, so a
 * copy is kept in node_modules/.cache by the source's sha256 and reused.
 *
 * Folders in tool-runtime/ that the manifest no longer names are removed, so
 * an old version never ships beside its replacement. Runs before every build
 * and dev server (package.json); the folder is gitignored.
 */
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants } from "node:zlib";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(WEB, "tool-runtime");
const manifest = JSON.parse(readFileSync(join(WEB, "scripts/tool-runtime.json"), "utf8"));

/** The installed package's root folder, resolved the way node would from `from`. */
function packageDir(name, from) {
  const require = createRequire(join(from, "package.json"));
  // Not every package exports ./package.json; its main entry always resolves.
  for (const probe of [`${name}/package.json`, name]) {
    try {
      let dir = dirname(require.resolve(probe));
      while (!existsSync(join(dir, "package.json")) || JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name !== name) {
        const up = dirname(dir);
        if (up === dir) throw new Error(`no package.json for ${name}`);
        dir = up;
      }
      return dir;
    } catch {
      // try the next probe
    }
  }
  throw new Error(`${name} is not installed (run pnpm install)`);
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const BR_CACHE = join(WEB, "node_modules/.cache/tool-runtime-br");
const DL_CACHE = join(WEB, "node_modules/.cache/tool-runtime-dl");

/** Stages the matching files of a pinned zip, fetched once into the cache. */
async function extract(out, file) {
  const zipPath = join(DL_CACHE, `${file.sha256}.zip`);
  if (!existsSync(zipPath) || sha256(zipPath) !== file.sha256) {
    const res = await fetch(file.url, { redirect: "follow" });
    if (!res.ok) throw new Error(`${file.url}: HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const got = createHash("sha256").update(bytes).digest("hex");
    if (got !== file.sha256) throw new Error(`${file.url}: sha256 ${got}, pinned ${file.sha256}`);
    mkdirSync(DL_CACHE, { recursive: true });
    writeFileSync(zipPath, bytes);
  }
  const { BlobReader, Uint8ArrayWriter, ZipReader, configure } = await import("@zip.js/zip.js");
  configure({ useWebWorkers: false });
  const match = new RegExp(file.extract.match);
  const reader = new ZipReader(new BlobReader(new Blob([readFileSync(zipPath)])));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  let n = 0;
  for (const e of await reader.getEntries()) {
    if (e.directory || !e.filename.startsWith(file.extract.prefix)) continue;
    let name = e.filename.slice(file.extract.prefix.length);
    if (!match.test(name)) continue;
    // flatten: "<folder>/<file>" is staged as "<folder>-<file>"; the match
    // is what keeps ".." and deeper paths out.
    if (file.extract.flatten) name = name.replace("/", "-");
    if (name.includes("/")) continue;
    writeFileSync(join(out, name), await e.getData(new Uint8ArrayWriter()));
    n++;
  }
  await reader.close();
  if (n === 0) throw new Error(`${file.url}: no file under ${file.extract.prefix} matches ${file.extract.match}`);
}
const COMPRESSIBLE = /\.(wasm|m?js|json)$/;

/** Writes `<file>.br` beside each compressible file of 64 KB or more under `dir`. */
function precompress(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      precompress(path);
      continue;
    }
    if (!COMPRESSIBLE.test(name) || statSync(path).size < 64 * 1024) continue;
    const cached = join(BR_CACHE, `${sha256(path)}.br`);
    if (!existsSync(cached)) {
      const bytes = readFileSync(path);
      mkdirSync(BR_CACHE, { recursive: true });
      const br = brotliCompressSync(bytes, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length },
      });
      writeFileSync(`${cached}.tmp`, br);
      cpSync(`${cached}.tmp`, cached);
      rmSync(`${cached}.tmp`);
    }
    copyFileSync(cached, `${path}.br`);
  }
}

async function stage(dir, entry) {
  const [, version] = dir.split(/@(?=[^@]+$)/);
  const out = join(ROOT, dir);

  if (entry.package) {
    const from = entry.via ? realpathSync(packageDir(entry.via, WEB)) : WEB;
    const pkg = packageDir(entry.package, from);
    const installed = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")).version;
    if (installed !== version) {
      throw new Error(`${dir}: ${entry.package} ${installed} is installed; move the folder (and the URL that names it) to @${installed}`);
    }
    rmSync(out, { recursive: true, force: true });
    for (const { from: src, to } of entry.copy) {
      const target = join(out, to);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(pkg, src), target, { recursive: true, dereference: true });
    }
  }

  for (const file of entry.download ?? []) {
    if (file.extract) {
      await extract(out, file);
      continue;
    }
    const target = join(out, file.to);
    if (existsSync(target) && sha256(target) === file.sha256) continue;
    mkdirSync(dirname(target), { recursive: true });
    const res = await fetch(file.url, { redirect: "follow" });
    if (!res.ok) throw new Error(`${file.url}: HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const got = createHash("sha256").update(bytes).digest("hex");
    if (got !== file.sha256) throw new Error(`${file.url}: sha256 ${got}, pinned ${file.sha256}`);
    writeFileSync(target, bytes);
  }

  if (entry.precompress) precompress(out);
}

mkdirSync(ROOT, { recursive: true });
for (const name of readdirSync(ROOT)) {
  if (name.includes("@") && !Object.hasOwn(manifest, name)) rmSync(join(ROOT, name), { recursive: true, force: true });
}
for (const [dir, entry] of Object.entries(manifest)) await stage(dir, entry);
console.log(`tool-runtime: ${Object.keys(manifest).length} folders staged`);
