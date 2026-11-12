// The page: the lab menu, a lab (topology, tasks, a console per device),
// the command index and the exam mode.

import { LABS, MODULES } from "./labs/index.js";
import { buildLab, checkLab } from "./engine/lab.js";
import { exec, prompt, help, complete } from "./engine/device.js";
import { status } from "./engine/net.js";
import { normalize } from "./engine/iface.js";
import { drawTopology } from "./topo.js";
import { hostBanner } from "./engine/host.js";
import { SUPPORT, tipUrl } from "./support.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// `code` in task text becomes <code>
const rich = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");

// --- progress (this browser only) ----------------------------------------------------------

const KEY = "ccna-labs.v1";
function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? { done: {} };
  } catch {
    return { done: {} };
  }
}
let progress = loadProgress();
function saveProgress() {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    /* private mode: progress lasts for the visit */
  }
}
// the work in a lab: every line typed, in order, on every device, and the
// answers, so coming back replays it instead of starting over
const WORK = "ccna-labs.work.v1";
let work = (() => {
  try {
    return JSON.parse(localStorage.getItem(WORK)) ?? {};
  } catch {
    return {};
  }
})();
function saveWork() {
  try {
    localStorage.setItem(WORK, JSON.stringify(work));
  } catch {
    /* full or private: the work lasts for the visit */
  }
}
// ask the browser not to clear this site's storage when it runs short of space
navigator.storage?.persist?.().catch(() => {});

// --- menu ---------------------------------------------------------------------------------------

const byModule = (id) => LABS.filter((l) => l.module === id);
function renderMenu(filter = "") {
  const box = $("#modules");
  const q = filter.trim().toLowerCase();
  box.innerHTML = "";
  for (const m of MODULES) {
    const labs = byModule(m.id).filter((l) => !q || l.title.toLowerCase().includes(q) || l.cmds.some((c) => c.toLowerCase().includes(q)) || m.title.toLowerCase().includes(q));
    if (!labs.length) continue;
    const done = labs.filter((l) => progress.done[l.id]).length;
    const wrap = document.createElement("div");
    wrap.className = "module";
    const open = q || current?.def.module === m.id || openModules.has(m.id);
    wrap.innerHTML = `<button aria-expanded="${open}"><span>${esc(m.title)}</span><span class="count">${done}/${labs.length}</span></button>`;
    const ul = document.createElement("ul");
    ul.hidden = !open;
    for (const l of labs) {
      const li = document.createElement("li");
      li.innerHTML = `<a href="#lab/${l.id}" class="${current?.def.id === l.id ? "current" : ""}"><span class="tick">${progress.done[l.id] ? "✓" : ""}</span><span>${esc(l.title)}</span>${l.hard ? '<span class="tag hard">challenge</span>' : l.kind === "sim" ? '<span class="tag sim">sim</span>' : ""}${l.extra ? '<span class="tag extra">not on 200-301</span>' : ""}</a>`;
      ul.appendChild(li);
    }
    wrap.querySelector("button").addEventListener("click", (e) => {
      ul.hidden = !ul.hidden;
      e.currentTarget.setAttribute("aria-expanded", String(!ul.hidden));
      if (ul.hidden) openModules.delete(m.id);
      else openModules.add(m.id);
    });
    wrap.appendChild(ul);
    box.appendChild(wrap);
  }
  const total = LABS.length;
  const done = LABS.filter((l) => progress.done[l.id]).length;
  $("#progress").innerHTML = `<b>${done}</b> / ${total} labs`;
}
const openModules = new Set();

// --- a lab --------------------------------------------------------------------------------------

let current = null; // { def, lab, selected, buffers, histories, exam }

function openLab(def, { exam = null } = {}) {
  const lab = buildLab(def);
  // routers and switches always have a console; a PC has one when it has an OS
  const consoles = def.devices.filter((d) => ["router", "switch", "l3switch"].includes(d.type) || d.os).map((d) => d.name);
  current = { def, lab, selected: consoles[0], consoles, buffers: {}, histories: {}, cursor: {}, exam, checked: null };
  for (const name of consoles) {
    const dev = lab.devices[name];
    current.buffers[name] = dev.host ? hostBanner(dev) : `\n${dev.banner ? dev.banner + "\n" : ""}\nPress RETURN to get started.\n\n`;
    current.histories[name] = [];
  }
  const main = $("#main");
  main.innerHTML = "";
  main.appendChild($("#lab-view").content.cloneNode(true));
  $(".work").classList.toggle("wide", !!def.hard);
  const mod = MODULES.find((m) => m.id === def.module);
  $(".crumbs").innerHTML = exam ? `<span>Exam · question ${exam.index + 1} of ${exam.list.length}</span>` : `<span>${esc(mod?.title ?? "")}</span>${def.hard ? '<span class="tag hard">challenge</span>' : def.kind === "sim" ? '<span class="tag sim">simulation</span>' : '<span class="tag">mini lab</span>'}${def.cmds.slice(0, 6).map((c) => `<span class="tag">${esc(c)}</span>`).join("")}`;
  $(".lab-title").textContent = def.title;
  $(".intro").innerHTML = rich(def.intro ?? "");
  // a question lab with an exhibit and no devices: no topology, no console
  const exhibit = $(".exhibit");
  exhibit.hidden = !def.exhibit;
  exhibit.textContent = def.exhibit ?? "";
  const solo = !consoles.length;
  $(".work").classList.toggle("solo", solo);
  $(".topo-panel").hidden = solo;
  $(".term-panel").hidden = solo;
  // replay what was typed here before (not in the exam)
  const saved = !exam && work[def.id];
  if (saved) {
    for (const [name, line] of saved.log ?? []) {
      const dev = current.lab.devices[name];
      if (!dev) continue;
      // ctrl-c: drop a half-typed password prompt
      if (line === "\u0003") {
        current.buffers[name] += prompt(dev) + "\n";
        dev.pending = null;
      } else runLine(name, line);
    }
    Object.assign(current.lab.answers, saved.answers ?? {});
  }
  renderTasks();
  renderTabs();
  renderTopology();
  renderScreen();
  wireLab();
  $(".term-first").hidden = !!exam || Object.keys(progress.done).length > 0 || !!saved?.log?.length || !def.devices.some((d) => ["router", "switch", "l3switch"].includes(d.type));
  if (saved?.log?.length) {
    const res = $(".result");
    res.className = "result";
    res.textContent = "Your earlier work in this lab is back. Reset starts it over.";
  }
  if (exam) {
    $(".theory-btn").hidden = true;
    $(".solution-btn").hidden = true;
    $(".check").textContent = exam.index + 1 < exam.list.length ? "Next question →" : "End exam";
    $(".reset-btn").hidden = false;
    const timer = $(".timer");
    timer.hidden = false;
    tickTimer();
  }
  renderMenu($("#search").value);
  $(".cmd").focus({ preventScroll: true });
}

function renderTasks(results) {
  const ol = $(".tasks");
  ol.innerHTML = "";
  const n = current.def.tasks.length;
  const done = results ? results.filter((r) => r.ok).length : 0;
  $(".tasks-panel .panel-title").innerHTML = `Tasks <span class="task-count">${results ? `${done} of ${n} complete <span class="meter" aria-hidden="true"><i style="width:${Math.round((done / n) * 100)}%"></i></span>` : `${n} task${n === 1 ? "" : "s"}`}</span>`;
  current.def.tasks.forEach((task, i) => {
    const li = document.createElement("li");
    const r = results?.[i];
    if (r) li.className = r.ok ? "ok" : "bad";
    li.innerHTML = rich(task.text) + answerBox(task, i, r) + (r && !r.ok && r.why ? `<span class="why">${rich(r.why)}</span>` : "");
    ol.appendChild(li);
    const box = li.querySelector(".answer");
    if (box?.tagName === "INPUT")
      box.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !current.exam) {
          e.preventDefault();
          $(".check").click();
        }
      });
    if (box)
      box.addEventListener(box.tagName === "INPUT" ? "input" : "change", (e) => {
        const value = box.tagName === "INPUT" ? box.value : e.target.value;
        // a new pick clears the marks from the last Check
        if (box.tagName !== "INPUT") for (const l of box.querySelectorAll(".choice")) l.className = `choice${l.querySelector("input").checked ? " on" : ""}`;
        current.lab.answers[i] = value;
        if (current.exam) return;
        ((work[current.def.id] ??= { log: [], answers: {} }).answers ??= {})[i] = value;
        saveWork();
      });
  });
}

// a task that asks something gets a text box, or its options laid out in
// full (as on the exam) when it has choices; after Check the one picked is
// marked right or wrong
function answerBox(task, i, r = null) {
  const v = current.lab.answers[i] ?? "";
  if (task.choices) {
    const mark = (c) => (c !== v ? "" : r ? (r.ok ? " on right" : " on wrong") : " on");
    return `<div class="answer choices" role="radiogroup" aria-label="Answer">${task.choices.map((c) => `<label class="choice${mark(c)}"><input type="radio" name="q${i}" value="${esc(c)}"${c === v ? " checked" : ""}><span>${esc(c)}</span></label>`).join("")}</div>`;
  }
  if (task.ask) return `<input class="answer" type="text" spellcheck="false" autocomplete="off" placeholder="${esc(task.ask)}" value="${esc(v)}" aria-label="Answer">`;
  return "";
}

function renderTabs() {
  if (!current.selected) return;
  const tabs = $(".tabs");
  tabs.innerHTML = "";
  for (const name of current.consoles) {
    const b = document.createElement("button");
    b.textContent = current.lab.devices[name].hostname;
    b.className = name === current.selected ? "on" : "";
    b.setAttribute("role", "tab");
    b.addEventListener("click", () => select(name));
    tabs.appendChild(b);
  }
}

// the light at one end of a link: green if both ends are up, amber while
// a switch port is still coming up after no shutdown, red if down
function lightOf(name, ifname) {
  const dev = current.lab.devices[name];
  const f = dev.interfaces[normalize(ifname)];
  if (!f) return "none";
  if (["pc", "server", "cloud", "phone"].includes(dev.type)) {
    const end = dev.links[f.name];
    const other = end?.device.interfaces[end.iface];
    return other && !other.shutdown ? "up" : "down";
  }
  const [st, pr] = status(dev, f);
  if (st === "up" && pr === "up") return f.channel && !isBundledSafe(dev, f) ? "amber" : "up";
  return "down";
}
function isBundledSafe(dev, f) {
  return true;
}

function renderTopology() {
  if (!current.selected) return;
  drawTopology($(".topo"), current.lab, {
    selected: current.selected,
    statusOf: lightOf,
    onPick: (name) => {
      const d = current.def.devices.find((x) => x.name === name);
      if (current.consoles.includes(name)) {
        $(".pc-info").hidden = true;
        select(name);
      } else {
        const box = $(".pc-info");
        box.hidden = !box.hidden && box.dataset.name === name;
        box.dataset.name = name;
        box.textContent = `${name}\nIPv4 Address . . : ${d.ip?.split("/")[0] ?? "DHCP"}\nSubnet Mask  . . : ${d.ip ? maskText(Number(d.ip.split("/")[1])) : "-"}\nDefault Gateway  : ${d.gateway ?? "-"}`;
      }
    },
  });
}
const maskText = (bits) => {
  const n = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
};

function select(name) {
  current.selected = name;
  renderTabs();
  renderTopology();
  renderScreen();
  $(".cmd").focus({ preventScroll: true });
}

function renderScreen() {
  if (!current.selected) return;
  const dev = current.lab.devices[current.selected];
  $(".out").textContent = current.buffers[current.selected];
  $(".prompt").textContent = prompt(dev);
  const input = $(".cmd");
  input.type = dev.pending?.secret ? "password" : "text";
  const screen = $(".screen");
  screen.scrollTop = screen.scrollHeight;
}

function write(text) {
  current.buffers[current.selected] += text;
}

function record(name, line) {
  if (current.exam) return;
  const w = (work[current.def.id] ??= { log: [], answers: {} });
  if (w.log.length < 3000) w.log.push([name, line]);
  w.at = Date.now();
  saveWork();
}

function submit(line) {
  const name = current.selected;
  runLine(name, line);
  record(name, line);
  // a hostname change renames the tab and the icon
  renderTabs();
  renderTopology();
  renderScreen();
}

// one line into one device's console, with its output in that buffer
function runLine(name, line) {
  const dev = current.lab.devices[name];
  const secret = dev.pending?.secret;
  const shown = secret ? "" : line;
  current.buffers[name] += prompt(dev) + shown + "\n";
  if (line.trim()) $(".term-first").hidden = true;
  if (!secret && line.trim()) {
    current.histories[name].push(line);
    current.cursor[name] = current.histories[name].length;
  }
  const out = exec(dev, line);
  // cls / clear
  if (out === "\f") current.buffers[name] = "";
  else if (out) current.buffers[name] += out.replace(/\n?$/, "\n");
}

function wireLab() {
  const input = $(".cmd");
  input.addEventListener("keydown", (e) => {
    const name = current.selected;
    const dev = current.lab.devices[name];
    if (e.key === "Enter") {
      e.preventDefault();
      const v = input.value;
      input.value = "";
      submit(v);
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (!dev.pending) input.value = complete(dev, input.value);
    } else if (e.key === "?" && !dev.pending && !dev.host) {
      e.preventDefault();
      write(prompt(dev) + input.value + "?\n" + help(dev, input.value) + "\n");
      renderScreen();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const h = current.histories[name];
      let c = current.cursor[name] ?? h.length;
      c = Math.max(0, Math.min(h.length, c + (e.key === "ArrowUp" ? -1 : 1)));
      current.cursor[name] = c;
      input.value = h[c] ?? "";
    } else if (e.ctrlKey && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      write(prompt(dev) + input.value + "^Z\n");
      input.value = "";
      const out = exec(dev, "^z");
      if (out) write(out + "\n");
      record(name, "^z");
      renderScreen();
    } else if (e.ctrlKey && (e.key === "c" || e.key === "C") && !window.getSelection()?.toString()) {
      e.preventDefault();
      write(prompt(dev) + input.value + "\n");
      input.value = "";
      if (dev.pending) dev.pending = null;
      record(name, "\u0003");
      renderScreen();
    }
  });
  // the keys a phone keyboard lacks: they act as if typed in the console
  for (const b of document.querySelectorAll(".softkeys button")) {
    // keep the focus (and the phone's keyboard) on the console input
    b.addEventListener("pointerdown", (e) => e.preventDefault());
    b.addEventListener("click", () => {
      const key = b.dataset.key;
      const dev = current.lab.devices[current.selected];
      // a PC's terminal has no ? help: there it is just a character
      if (key === "?" && dev.host) input.value += "?";
      else input.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: Boolean(b.dataset.ctrl), bubbles: true, cancelable: true }));
      input.focus({ preventScroll: true });
    });
  }
  $(".screen").addEventListener("click", () => {
    if (!window.getSelection()?.toString()) input.focus({ preventScroll: true });
  });
  $(".check").addEventListener("click", () => {
    if (current.exam) return examNext();
    const results = checkLab(current.lab);
    renderTasks(results);
    const ok = results.every((r) => r.ok);
    const res = $(".result");
    res.className = `result ${ok ? "ok" : "bad"}`;
    res.textContent = ok ? "All tasks complete." : `${results.filter((r) => r.ok).length} of ${results.length} tasks correct. The marked ones say what is missing.`;
    if (ok) res.insertAdjacentHTML("beforeend", ` <span class="nudge">Finding these useful? <a href="#" data-tip>Leave a tip</a>.</span>`);
    if (ok) {
      progress.done[current.def.id] = Date.now();
      track(`done/${current.def.id}`, true);
      saveProgress();
      renderMenu($("#search").value);
      const next = nextLab(current.def);
      if (next) {
        const b = $(".next-btn");
        b.hidden = false;
        b.onclick = () => (location.hash = `#lab/${next.id}`);
      }
    }
  });
  const toggle = (btn, box, fill) => {
    const b = $(btn), el = $(box);
    b.setAttribute("aria-expanded", "false");
    b.addEventListener("click", () => {
      el.hidden = !el.hidden;
      b.setAttribute("aria-expanded", String(!el.hidden));
      if (!el.hidden) {
        el.innerHTML = fill();
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
  };
  toggle(".theory-btn", ".theory", () => `<h3>Theory</h3><p class="teach">${rich(current.def.teach ?? "")}</p>${current.def.cmds.length ? `<h3>Commands</h3><p class="cmd-list">${current.def.cmds.map((c) => `<code>${esc(c)}</code>`).join("")}</p>` : ""}`);
  toggle(".solution-btn", ".solution", () => solutionHtml(current.def));
  $(".reset-btn").addEventListener("click", () => {
    if (!current.exam) {
      delete work[current.def.id];
      saveWork();
    }
    openLab(current.def, { exam: current.exam });
  });
}

// one correct answer: what to type, device by device in the order it is
// done, then the answers to the questions
function solutionHtml(def) {
  const steps = Object.entries(def.solution).map(([key, lines]) => [key.split("#")[0], lines.filter((l) => l !== "")]).filter(([, lines]) => lines.length);
  const answers = Object.entries(def.answers ?? {});
  const note = steps.length ? "Try it yourself first. Other answers are correct too: the check looks at the resulting configuration and what the network does, not the exact words you typed." : "Try it yourself first.";
  let html = `<h3>One correct answer</h3><p class="sol-note">${note}</p>`;
  if (steps.length) html += `<h4>${steps.length > 1 ? "Commands, in order" : "Commands"}</h4><ol class="sol-steps${steps.length > 1 ? "" : " single"}">${steps.map(([dev, lines]) => `<li><span class="sol-dev">${esc(dev)}</span><pre>${esc(lines.join("\n"))}</pre></li>`).join("")}</ol>`;
  if (answers.length) html += `<h4>Answers to the questions</h4><dl class="sol-answers">${answers.map(([i, a]) => `<dt>Task ${Number(i) + 1}</dt><dd>${rich(String(a))}</dd>`).join("")}</dl>`;
  return html;
}

function nextLab(def) {
  const i = LABS.indexOf(def);
  return LABS[i + 1] ?? null;
}

// --- command index -------------------------------------------------------------------------------

function renderCommands() {
  current = null;
  const index = new Map();
  for (const l of LABS) for (const c of l.cmds) (index.get(c) ?? index.set(c, []).get(c)).push(l);
  const rows = [...index.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  // a filter box on the page itself (the sidebar search is hidden on phones),
  // labs listed under each command, the finished ones ticked
  $("#main").innerHTML = `<section class="page"><h1>Commands</h1><p class="lead">Every command and the labs that use it. ${rows.length} commands in ${LABS.length} labs.</p>
  <div class="cmd-filter"><input id="cmd-filter" type="search" placeholder="Filter, e.g. show ip ospf or trunk" aria-label="Filter commands" autocomplete="off" spellcheck="false"><span class="cmd-count" aria-live="polite">${rows.length} commands</span></div>
  <div class="cmd-index">${rows.map(([c, labs]) => `<div class="cmd-row" data-cmd="${esc(c.toLowerCase())}"><code>${esc(c)}</code><span class="labs">${labs.map((l) => `<a href="#lab/${l.id}"${progress.done[l.id] ? ' class="done" title="Finished"' : ""}>${esc(l.title)}</a>`).join("")}</span></div>`).join("")}</div>
  <p class="cmd-none" hidden>No command matches. Try a shorter part of it.</p></section>`;
  const box = $("#cmd-filter");
  box.addEventListener("input", () => {
    const q = box.value.trim().toLowerCase().replace(/\s+/g, " ");
    let n = 0;
    for (const r of $("#main").querySelectorAll(".cmd-row")) {
      const hit = !q || r.dataset.cmd.includes(q);
      r.hidden = !hit;
      if (hit) n++;
    }
    $(".cmd-count").textContent = `${n} command${n === 1 ? "" : "s"}`;
    $(".cmd-none").hidden = n > 0;
  });
  renderMenu($("#search").value);
}

// --- exam mode ---------------------------------------------------------------------------------------

let examState = null;
function renderExamStart() {
  current = null;
  const sims = LABS.filter((l) => l.kind === "sim" && !l.extra).length;
  $("#main").innerHTML = `<section class="page"><h1>Exam simulation</h1>
  <div class="exam-card"><h2>How it works</h2>
  <p>You get random labs like the exam simulations. There is no theory, no answers and no checking along the way, and you cannot go back to a previous question, as in the real exam. At the end you see what passed and what did not.</p>
  <p>Simulations available: ${sims}. Mini labs fill the rest of the test.</p>
  <div class="buttons"><button class="btn primary" data-n="5" data-min="25">5 questions · 25 minutes</button><button class="btn" data-n="10" data-min="45">10 questions · 45 minutes</button></div>
  <h2>Harder than the exam</h2>
  <p>Only challenge labs: bigger topologies, several topics in one lab, faults to find and questions on the output.</p>
  <div class="buttons"><button class="btn" data-n="3" data-min="45" data-hard="1">3 challenge labs · 45 minutes</button></div></div></section>`;
  for (const b of $("#main").querySelectorAll("[data-n]")) b.addEventListener("click", () => startExam(Number(b.dataset.n), Number(b.dataset.min), Boolean(b.dataset.hard)));
  renderMenu($("#search").value);
}

function startExam(n, minutes, hard = false) {
  const pool = LABS.filter((l) => !l.extra && l.module !== "basics");
  const sims = shuffle(pool.filter((l) => l.kind === "sim" && !l.hard));
  const micros = shuffle(pool.filter((l) => l.kind !== "sim"));
  const list = hard ? shuffle(pool.filter((l) => l.hard)).slice(0, n) : [...sims.slice(0, Math.ceil(n * 0.6)), ...micros].slice(0, n);
  examState = { list: shuffle(list), index: 0, results: [], started: Date.now(), minutes, ends: Date.now() + minutes * 60000 };
  openLab(examState.list[0], { exam: examState });
}
function shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}
function examNext() {
  examState.results.push({ def: current.def, results: checkLab(current.lab) });
  examState.index++;
  if (examState.index < examState.list.length && Date.now() < examState.ends) return openLab(examState.list[examState.index], { exam: examState });
  finishExam();
}
function finishExam() {
  track("exam-done", true);
  const all = examState.results.flatMap((r) => r.results);
  const pct = all.length ? Math.round((all.filter((r) => r.ok).length / all.length) * 100) : 0;
  // the real exam is scored out of 1000, pass mark around 825
  const scaled = Math.round(300 + pct * 7);
  current = null;
  const okCount = all.filter((r) => r.ok).length;
  const full = examState.results.filter((r) => r.results.every((x) => x.ok)).length;
  const used = Math.min(examState.minutes * 60, Math.round((Date.now() - examState.started) / 1000));
  const topics = new Map();
  for (const r of examState.results) {
    const name = MODULES.find((m) => m.id === r.def.module)?.title ?? r.def.module;
    const t = topics.get(name) ?? { ok: 0, n: 0 };
    t.ok += r.results.filter((x) => x.ok).length;
    t.n += r.results.length;
    topics.set(name, t);
  }
  const rows = [...topics].sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n || a[0].localeCompare(b[0]));
  const share = (t) => Math.round((t.ok / t.n) * 100);
  $("#main").innerHTML = `<section class="page"><h1>Score report</h1><div class="exam-card report"><div class="score">${scaled} / 1000</div><p class="verdict">${scaled >= 825 ? "Above" : "Below"} the usual passing score of about 825 out of 1000.</p>
  <dl class="facts"><div><dt>Tasks correct</dt><dd>${okCount} of ${all.length} (${pct}%)</dd></div><div><dt>Labs fully correct</dt><dd>${full} of ${examState.results.length}</dd></div><div><dt>Time used</dt><dd>${Math.floor(used / 60)}:${String(used % 60).padStart(2, "0")} of ${examState.minutes}:00</dd></div></dl></div>
  <h2 class="report-h">By topic</h2>
  <table class="by-topic"><thead><tr><th>Topic</th><th>Tasks correct</th><th></th></tr></thead><tbody>${rows.map(([name, t]) => `<tr><td>${esc(name)}</td><td>${t.ok} of ${t.n}</td><td><span class="meter"><i style="width:${share(t)}%"></i></span> ${share(t)}%</td></tr>`).join("")}</tbody></table>
  <h2 class="report-h">Each lab</h2>
  <ol class="exam-results">${examState.results.map((r) => `<li><a href="#lab/${r.def.id}">${esc(r.def.title)}</a>: ${r.results.filter((x) => x.ok).length}/${r.results.length}${r.results.filter((x) => !x.ok).map((x) => `<div class="why">✗ ${rich(x.text)}</div>`).join("")}</li>`).join("")}</ol>
  <div class="buttons"><a class="btn" href="#exam">New exam</a><button class="btn tip" type="button" data-tip>${HEART}Leave a tip</button></div></section>`;
  examState = null;
}
function tickTimer() {
  const t = $(".timer");
  if (!t || !examState) return;
  const left = Math.max(0, examState.ends - Date.now());
  const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
  t.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  if (left <= 0) return examNext();
  setTimeout(tickTimer, 1000);
}

// --- home ------------------------------------------------------------------------------------------------

// the lab to pick up: the one last worked on, else the first one not done
function resumeLab() {
  const recent = Object.entries(work).filter(([id]) => LABS.some((l) => l.id === id) && !progress.done[id]).sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0))[0];
  if (recent) return LABS.find((l) => l.id === recent[0]);
  return Object.keys(progress.done).length ? LABS.find((l) => !progress.done[l.id]) ?? null : null;
}

// the labs the home page puts first: exam-style sims on the topics the exam
// weighs most, and one challenge
const FEATURED = ["sim-vlans", "sim-roas", "sim-ospf", "sim-acl", "sim-nat", "ch-summary-loop", "ex-subnet-drill", "ex-vlsm", "ex-ports"];
const FIRST_SIM = "sim-vlans";

const FEATURES = [
  ["Feels like IOS", "Modes, abbreviations, <code>?</code> help, Tab completion, history, <code>do</code>, pipes and the real error messages with the caret under the mistake."],
  ["Checked for you", "Press Check and every task is graded on the network you built, not on the words you typed. Any correct answer passes."],
  ["A network behind it", "OSPF elects a DR and runs SPF, STP blocks ports, ACLs count matches, NAT translates, and ping and traceroute go hop by hop."],
  ["Exam mode", "Timed random simulations with no hints and no going back, scored out of 1000 like the real exam. Challenge labs go further."],
  ["PCs with real terminals", "Windows, Linux and macOS hosts with ipconfig, ip addr, ifconfig, nslookup, dig, ping, tracert and traceroute."],
  ["Nothing to install", "Runs in any browser, phone included. No account, no ads. Your progress stays in your browser and can be exported."],
];

function renderHome() {
  current = null;
  const cmds = new Set(LABS.flatMap((l) => l.cmds)).size;
  const sims = LABS.filter((l) => l.kind === "sim").length;
  const hard = LABS.filter((l) => l.hard).length;
  const theory = LABS.filter((l) => l.module === "exhibits").length;
  const done = Object.keys(progress.done).filter((id) => LABS.some((l) => l.id === id)).length;
  const resume = resumeLab();
  const trySim = (cls) => `<a class="btn ${cls} big" href="#lab/${FIRST_SIM}" data-track="cta-sim">Try an exam-style sim</a>`;
  const start = resume ? `<a class="btn primary big" href="#lab/${resume.id}" data-track="cta-continue">Continue: ${esc(resume.title)}</a>${trySim("")}` : `${trySim("primary")}<a class="btn big" href="#lab/${LABS[0].id}" data-track="cta-basics">Start from the basics</a>`;
  const short = (t) => esc(t.replace(/^(Sim|Challenge): (.)/, (_, k, c) => c.toUpperCase()));
  const firstSentence = (t) => esc((t ?? "").split(/(?<=[.!?])\s/)[0]);
  const featured = FEATURED.map((id) => LABS.find((l) => l.id === id)).filter(Boolean);
  $("#main").innerHTML = `<section class="welcome">
  <div class="hero">
    <div class="hero-text">
      <p class="eyebrow">Free · No sign-up · Runs in your browser</p>
      <h1>Practise for the CCNA in a Cisco CLI that answers back</h1>
      <p class="lead">${LABS.length} hands-on labs for CCNA 200-301. Configure routers, switches and PCs from the command line, then press Check: every task is graded on the network you built.</p>
      <div class="cta">${start}</div>
      <p class="cta-more">${resume ? `<a href="#lab/${LABS[0].id}" data-track="cta-basics">Start from the basics</a> · ` : ""}<a href="#exam" data-track="cta-exam">Take a timed practice exam</a></p>
      ${done ? `<p class="mine">${done} of ${LABS.length} labs done in this browser.</p>` : ""}
    </div>
    <pre class="demo" aria-label="Example console session"><span class="p">R1#</span>conf t
Enter configuration commands, one per line.  End with CNTL/Z.
<span class="p">R1(config)#</span>int g0/0
<span class="p">R1(config-if)#</span>ip add 10.1.1.1 255.255.255.0
<span class="p">R1(config-if)#</span>no shut
%LINK-3-UPDOWN: Interface GigabitEthernet0/0, changed state to up
<span class="p">R1(config-if)#</span>router ospf 1
<span class="p">R1(config-router)#</span>network 10.0.12.0 0.0.0.3 area 0
%OSPF-5-ADJCHG: Process 1, Nbr 2.2.2.2 on GigabitEthernet0/1 from LOADING to FULL, Loading Done
<span class="p">R1(config-router)#</span>do ping 10.3.3.10
!!!!!
Success rate is 100 percent (5/5)<span class="cursor"></span></pre>
  </div>
  <div class="stats">
    <div><b>${LABS.length}</b><span>labs</span></div>
    <div><b>${sims}</b><span>exam-style sims</span></div>
    <div><b>${hard}</b><span>challenge labs</span></div>
    <div><b>${cmds}</b><span>commands</span></div>
    <div><b>${theory}</b><span>theory question sets</span></div>
  </div>
  ${Object.keys(progress.done).length ? "" : `<ol class="howto" aria-label="How a lab works">
    <li><b>Read the tasks</b><span>Each lab sets a scenario and a short list of tasks, like an exam simulation.</span></li>
    <li><b>Type in the console</b><span>Click a router, switch or PC in the topology and configure it with real IOS commands. <code>?</code> and Tab work.</span></li>
    <li><b>Press Check</b><span>Every task is graded on the network you built. Theory and Answer are there when you are stuck.</span></li>
  </ol>`}
  <h2 class="section">Popular labs</h2>
  <p class="hint">Exam-style scenarios on the topics the exam weighs most, and quick theory sets such as subnetting. Each is checked when you press Check.</p>
  <div class="popular">${featured.map((l) => `<a class="pop" href="#lab/${l.id}" data-track="pop/${l.id}"><span class="pop-meta">${esc(MODULES.find((m) => m.id === l.module)?.title ?? "")} · ${l.tasks.length} tasks ${l.hard ? '<span class="tag hard">challenge</span>' : l.module === "exhibits" ? '<span class="tag">theory</span>' : '<span class="tag sim">sim</span>'}${progress.done[l.id] ? ' <span class="pop-done">done</span>' : ""}</span><b>${short(l.title)}</b><span class="pop-intro">${firstSentence(l.intro)}</span></a>`).join("")}</div>
  <div class="features">${FEATURES.map(([t, d]) => `<div class="feature"><h3>${t}</h3><p>${d}</p></div>`).join("")}</div>
  <h2 class="section">Modules</h2>
  <p class="hint">Labs marked <span class="tag sim">sim</span> are short scenarios like the exam simulations; the others teach one command each. Challenge labs mix several topics with faults to find.</p>
  <div class="grid">${MODULES.map((m) => {
    const labs = byModule(m.id);
    const d = labs.filter((l) => progress.done[l.id]).length;
    return `<a class="mod" href="#lab/${labs[0]?.id}"><b>${esc(m.title)}</b><span>${esc(m.blurb)} · ${labs.length} labs</span><div class="bar"><i style="width:${labs.length ? (d / labs.length) * 100 : 0}%"></i></div></a>`;
  }).join("")}</div>
  <div class="support-card">
    <div><h2>Free, open source, and kept that way</h2><p>No ads and no paywall. If these labs help you study, a small tip pays for the time that goes into new labs and fixes.</p></div>
    <div class="support-actions"><button class="btn tip big" type="button" data-tip>${HEART}Leave a tip</button><a class="btn big" href="${SUPPORT.repo}" target="_blank" rel="noopener">Star on GitHub</a></div>
  </div>
  <div class="keep"><p>Your progress and the work inside each lab stay in this browser. To move them to another browser, or to keep a copy, save them to a file.</p>
  <button class="btn export-btn">Export progress</button> <label class="btn">Import progress<input type="file" class="import-file" accept=".json,application/json" hidden></label> <span class="keep-msg"></span></div>
  <footer class="foot"><p>CCNA Practise is an independent study tool. It is not affiliated with, sponsored or endorsed by Cisco Systems, Inc. Cisco, Cisco IOS and CCNA are trademarks of Cisco Systems, Inc. The console is a simulation written from scratch, not Cisco software.</p>
  <p><a href="${SUPPORT.repo}" target="_blank" rel="noopener">Source on GitHub</a> · MIT licence · <a href="${SUPPORT.repo}/issues" target="_blank" rel="noopener">Report a problem</a> · <a href="#" data-tip>Tip jar</a></p>
  <p>Visits are counted anonymously with GoatCounter: no cookies, nothing personal.</p></footer>
  </section>`;
  $(".export-btn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ app: "ccna-labs", v: 1, progress, work }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ccna-practise-progress-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $(".import-file").addEventListener("change", async (e) => {
    const msg = $(".keep-msg");
    try {
      const data = JSON.parse(await e.target.files[0].text());
      if (data.app !== "ccna-labs" || typeof data.progress?.done !== "object") throw new Error();
      // merge: a lab done in either copy stays done, and the newer work wins
      for (const [id, t] of Object.entries(data.progress.done)) if (LABS.some((l) => l.id === id)) progress.done[id] = Math.max(progress.done[id] ?? 0, t);
      for (const [id, w] of Object.entries(data.work ?? {})) if (LABS.some((l) => l.id === id) && Array.isArray(w?.log) && (w.at ?? 0) >= (work[id]?.at ?? 0)) work[id] = w;
      saveProgress();
      saveWork();
      renderHome();
      $(".keep-msg").textContent = `Imported. ${Object.keys(progress.done).length} ${Object.keys(progress.done).length === 1 ? "lab" : "labs"} done.`;
    } catch {
      msg.textContent = "That file is not a CCNA Labs progress export.";
    }
  });
  renderMenu($("#search").value);
}

// --- tip jar ---------------------------------------------------------------------------------------------

const HEART = '<svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.3C1 8.4 3 5 6.4 5c2 0 3.4 1.1 4.1 2.3h3C14.2 6.1 15.6 5 17.6 5 21 5 23 8.4 21.6 11.7 19.5 16.4 12 21 12 21z"/></svg>';
function openTip() {
  track("tip-open", true);
  const box = $("#tip-dialog");
  const url = tipUrl();
  box.querySelector(".tip-actions").innerHTML = url
    ? `<a class="btn primary big paypal" href="${url}" target="_blank" rel="noopener" onclick="window.__track?.('tip-paypal', true)">Tip with PayPal</a><span class="tip-small">Any amount, card or PayPal balance. Thank you.</span>`
    : `<p class="tip-soon">The PayPal tip jar opens very soon. In the meantime a star on <a href="${SUPPORT.repo}" target="_blank" rel="noopener">GitHub</a> helps a lot.</p>`;
  if (box.showModal) box.showModal();
  else box.setAttribute("open", "");
}
// which home page buttons and cards people use
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-track]");
  if (t) track(`click/${t.dataset.track}`, true);
});
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-tip]");
  if (!t) return;
  e.preventDefault();
  openTip();
});

// --- visit counts ------------------------------------------------------------------------------------------

// GoatCounter (nasus.goatcounter.com): anonymous counts, no cookies. Only the
// live site loads it, never a local copy or the tests. Opening the site once
// with #toggle-goatcounter stops (or restarts) counting this browser.
const COUNTER = "https://nasus.goatcounter.com/count";
const LIVE = location.hostname.endsWith("github.io");
const skipCount = () => {
  try {
    return localStorage.getItem("skipgc") === "t";
  } catch {
    return false;
  }
};
const queued = [];
function track(path, event = false) {
  if (!LIVE || skipCount()) return;
  const send = () => window.goatcounter.count({ path, title: path, event });
  if (window.goatcounter?.count) send();
  else queued.push(send);
}
if (LIVE) {
  const gc = document.createElement("script");
  gc.async = true;
  gc.src = "https://gc.zgo.at/count.js";
  gc.dataset.goatcounter = COUNTER;
  // the page counts its own views (the labs live after the #)
  gc.dataset.goatcounterSettings = JSON.stringify({ no_onload: true });
  gc.addEventListener("load", () => queued.splice(0).forEach((f) => f()));
  document.head.append(gc);
}

// --- new versions ---------------------------------------------------------------------------------------

// the live site stamps its version into <meta name="build"> and version.json;
// when they differ a newer version is out, so offer a reload (the progress
// and the work in every lab are in localStorage and survive it)
const BUILD = document.querySelector('meta[name="build"]')?.content;
async function checkVersion() {
  if (!BUILD || BUILD === "dev" || !$("#update").hidden) return;
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    const { v } = await r.json();
    if (v && v !== BUILD) $("#update").hidden = false;
  } catch {
    /* offline: try again later */
  }
}
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && checkVersion());
setInterval(checkVersion, 10 * 60 * 1000);

// --- routing -------------------------------------------------------------------------------------------------

function route() {
  const hash = location.hash.slice(1);
  if (hash === "toggle-goatcounter") {
    try {
      const off = skipCount();
      if (off) localStorage.removeItem("skipgc");
      else localStorage.setItem("skipgc", "t");
      alert(off ? "Visits from this browser are counted again." : "Visits from this browser are no longer counted.");
    } catch {
      /* no storage: nothing to remember */
    }
    history.replaceState(null, "", location.pathname);
  }
  track(hash.startsWith("lab/") ? `/${hash}` : hash === "commands" || hash === "exam" ? `/${hash}` : "/");
  for (const a of document.querySelectorAll(".views a")) a.classList.toggle("on", a.dataset.view === (hash.startsWith("commands") ? "commands" : hash.startsWith("exam") ? "exam" : "labs"));
  $("#menu").classList.remove("open");
  if (hash.startsWith("lab/")) {
    const def = LABS.find((l) => l.id === hash.slice(4));
    if (def) {
      examState = null;
      openModules.add(def.module);
      return openLab(def);
    }
  }
  if (hash === "commands") return renderCommands();
  if (hash === "exam") return renderExamStart();
  renderHome();
  // a link straight to the tip jar (the README uses it)
  if (hash === "tip") openTip();
}

$("#search").addEventListener("input", (e) => renderMenu(e.target.value));
$("#menu-toggle").addEventListener("click", () => $("#menu").classList.toggle("open"));
window.addEventListener("hashchange", route);
route();

// for the smoke test
window.__track = track;
window.__ccna = { get current() { return current; }, LABS, checkLab };
