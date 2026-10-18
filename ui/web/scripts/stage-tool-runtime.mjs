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
 *    already staged with the right hash is not fetched again.
 *
 * Folders in tool-runtime/ that the manifest no longer names are removed, so
 * an old version never ships beside its replacement. Runs before every build
 * and dev server (package.json); the folder is gitignored.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
}

mkdirSync(ROOT, { recursive: true });
for (const name of readdirSync(ROOT)) {
  if (name.includes("@") && !Object.hasOwn(manifest, name)) rmSync(join(ROOT, name), { recursive: true, force: true });
}
for (const [dir, entry] of Object.entries(manifest)) await stage(dir, entry);
console.log(`tool-runtime: ${Object.keys(manifest).length} folders staged`);
