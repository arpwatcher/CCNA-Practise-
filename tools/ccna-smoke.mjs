// Drives the CCNA labs page in headless Chromium the way a person would:
// opens labs, types each model answer into the right console, presses
// Check and expects every task ticked; then opens the command index and
// the exam view. Any console error fails it.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
// SITE_ROOT=site runs it against the built site (tools/build-site.mjs)
const root = process.env.SITE_ROOT ? resolve(process.env.SITE_ROOT) : fileURLToPath(new URL("..", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png" };

const server = http.createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
  try {
    const body = await readFile(join(root, path || "index.html"));
    res.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://localhost:${server.address().port}/index.html`;

// one of each kind: single device, two routers, a switch sim, a sim with
// prompts, PCs with terminals and answer boxes, and four challenge labs
const LABS = ["hostname", "sim-dhcp", "sim-access-security", "ssh", "sim-ospf", "win-apipa", "sim-three-hosts", "ch-floor-dhcp", "ch-l3-core", "ch-ospf-election", "ch-errdisable", "ch-dual-isp", "ch-acl-hunt", "ex-qos", "aaa-tacacs", "ch-aaa", "duplex-mismatch", "ch-branch-voice", "ch-ipv6-edge", "ch-trace-ticket", "ch-wan-branch", "sim-routing-loop", "ch-bundle-stp"];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
let failed = 0;
const ok = (good, what) => {
  console.log(`${good ? "ok" : "not ok"} - ${what}`);
  if (!good) failed++;
};

await page.goto(base);
await page.waitForFunction(() => window.__ccna);
for (const id of LABS) {
  await page.goto(`${base}#lab/${id}`);
  await page.waitForFunction((want) => window.__ccna.current?.def.id === want, id);
  const { solution, answers } = await page.evaluate(() => ({ solution: window.__ccna.current.def.solution, answers: window.__ccna.current.def.answers ?? {} }));
  for (const [key, lines] of Object.entries(solution)) {
    const name = key.split("#")[0];
    const index = await page.evaluate((n) => window.__ccna.current.consoles.indexOf(n), name);
    await page.locator(".tabs button").nth(index).click();
    for (const line of lines) {
      await page.fill(".cmd", line);
      await page.press(".cmd", "Enter");
    }
  }
  for (const [i, a] of Object.entries(answers)) {
    const box = page.locator(".tasks li").nth(Number(i)).locator(".answer");
    if ((await box.evaluate((e) => e.tagName)) === "SELECT") await box.selectOption(a);
    else await box.fill(a);
  }
  await page.click(".check");
  const ticks = await page.$$eval(".tasks li", (lis) => lis.map((li) => li.className));
  ok(ticks.length > 0 && ticks.every((c) => c === "ok"), `${id}: typing the answer ticks every task (${ticks.join(" ")})`);
  ok((await page.textContent(".result")).includes("Correct"), `${id}: the result says so`);
}

// a challenge lab draws its topology across the full width, and the bundle
// it built (ch-bundle-stp, the last lab above) is circled
ok(await page.locator(".work.wide").count() === 1, "a challenge lab gets the wide layout");
ok(await page.locator(".topo ellipse.bundle").count() === 1, "the EtherChannel is drawn as a bundle");
// an exhibit question lab shows its exhibit and no topology or console
await page.goto(`${base}#lab/ex-json`);
await page.waitForFunction(() => window.__ccna.current?.def.id === "ex-json");
ok((await page.locator(".exhibit").isVisible()) && (await page.locator(".topo-panel").isHidden()) && (await page.locator(".term-panel").isHidden()), "an exhibit lab shows the exhibit and hides the topology and console");
await page.goto(`${base}#exam`);
await page.waitForTimeout(200);
await page.click("[data-hard]");
await page.waitForFunction(() => window.__ccna.current?.def);
ok(await page.evaluate(() => window.__ccna.current.def.hard === true), "the harder exam starts with a challenge lab");

// what was typed in a lab comes back after a reload, and Reset starts over
const open = async (id) => {
  await page.goto(`${base}#lab/${id}`);
  await page.reload();
  await page.waitForFunction((want) => window.__ccna.current?.def.id === want, id);
};
await open("hostname");
const last = await page.evaluate(() => Object.values(window.__ccna.current.def.solution)[0].at(-1));
ok((await page.textContent(".result")).includes("earlier work") && (await page.textContent(".screen")).includes(last), "a reload replays the work in a lab");
await page.click(".reset-btn");
await open("hostname");
ok(!(await page.textContent(".result")).includes("earlier work") && !(await page.textContent(".screen")).includes(last), "Reset forgets it");
await page.goto(`${base}#`);
await page.waitForTimeout(200);
ok((await page.locator(".export-btn").count()) === 1 && (await page.locator(".import-file").count()) === 1, "the home page offers export and import");
ok((await page.locator(".hero h1").isVisible()) && (await page.locator(".stats").isVisible()), "the home page shows the hero and the numbers");
ok((await page.locator(".tip-btn").isVisible()) && (await page.locator(".support-card [data-tip]").isVisible()), "the tip jar is in the header and on the home page");
await page.click(".tip-btn");
await page.waitForTimeout(100);
ok(await page.locator("#tip-dialog").isVisible(), "the tip jar opens its dialog");
ok((await page.locator("#tip-dialog a.paypal").getAttribute("href"))?.startsWith("https://www.paypal.com/paypalme/"), "the tip jar links to PayPal");
await page.click("#tip-dialog .close");
await page.waitForTimeout(100);
ok(!(await page.locator("#tip-dialog").isVisible()), "and closes it");
await page.goto(`${base}#tip`);
await page.waitForTimeout(200);
ok(await page.locator("#tip-dialog").isVisible(), "a #tip link opens the tip jar");
await page.click("#tip-dialog .close");
// a phone: nothing in the header runs off the screen
await page.setViewportSize({ width: 360, height: 740 });
await page.waitForTimeout(150);
const tipBox = await page.locator(".tip-btn").boundingBox();
ok(tipBox && tipBox.x + tipBox.width <= 360 && (await page.evaluate(() => document.documentElement.scrollWidth)) <= 360, "the tip jar fits the header on a 360px phone");
await page.setViewportSize({ width: 1280, height: 800 });

await page.goto(`${base}#commands`);
await page.waitForTimeout(200);
ok((await page.locator("main").innerText()).includes("ip helper-address"), "the command index lists commands");
ok((await page.locator("main").innerText()).includes("ipconfig /all"), "the command index lists the PC commands");
await page.goto(`${base}#exam`);
await page.waitForTimeout(200);
ok((await page.locator("main").innerText()).length > 50, "the exam view renders");

// the built site: every file carries the version, and a newer version.json brings up the reload notice
if (process.env.SITE_ROOT) {
  await page.goto(`${base}#`);
  await page.waitForTimeout(200);
  const build = await page.getAttribute('meta[name="build"]', "content");
  ok(build && build !== "dev", "the built page knows its version");
  ok(await page.evaluate((v) => [...document.scripts].some((s) => s.src.includes(`app.js?v=${v}`)), build), "app.js is loaded with the version stamp");
  ok(await page.locator("#update").isHidden(), "no reload notice while the version is current");
  await page.route("**/version.json*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ v: "newer" }) }));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(300);
  ok(await page.locator("#update").isVisible(), "a newer version brings up the reload notice");
  await page.unroute("**/version.json*");
}

ok(errors.length === 0, `no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
