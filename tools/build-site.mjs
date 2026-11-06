// Builds what GitHub Pages serves: the page's files only, with every file
// stamped with the build's version, so a browser can never mix files from
// two versions. index.html gets the version in <meta name="build"> and
// version.json holds it too: the page compares the two to offer a reload
// when a newer version is out.
//
//   node tools/build-site.mjs <out dir> [version]

import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = process.argv[2] ?? "site";
const version = (process.argv[3] ?? new Date().toISOString().replace(/\D/g, "").slice(0, 12)).slice(0, 12);
if (!/^[\w.-]+$/.test(version)) throw new Error(`bad version: ${version}`);

export const FILES = ["index.html", "app.js", "style.css", "topo.js", "support.js", "favicon.svg", "og.png", "engine", "labs"];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const f of FILES) await cp(join(root, f), join(out, f), { recursive: true });

// every relative import gets ?v=<version>
const stamp = (src) => src.replace(/(from\s*"\.{1,2}\/[^"?]+\.js)"/g, `$1?v=${version}"`);
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p);
    else if (e.name.endsWith(".js")) await writeFile(p, stamp(await readFile(p, "utf8")));
  }
}
await walk(out);

let html = await readFile(join(out, "index.html"), "utf8");
const before = html;
html = html
  .replace('src="app.js"', `src="app.js?v=${version}"`)
  .replace('href="style.css"', `href="style.css?v=${version}"`)
  .replace('<meta name="build" content="dev">', `<meta name="build" content="${version}">`);
if (html === before || !html.includes(`content="${version}"`)) throw new Error("index.html: script, stylesheet or build meta not found");
await writeFile(join(out, "index.html"), html);
await writeFile(join(out, "version.json"), JSON.stringify({ v: version }) + "\n");
await writeFile(join(out, ".nojekyll"), "");
console.log(`built ${out} (version ${version})`);
