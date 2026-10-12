"use strict";

const TOTAL = "全国一般公共预算支出";
const OTHER = "其他";
const PALETTE = [
  "#f28e1c", "#2bb3e6", "#e23c52", "#7b2d8e", "#5a6fd6", "#1f8a80", "#4cc35a", "#9c7b3c",
  "#a46bd6", "#3d8ee8", "#c4572b", "#b8a92a", "#d85c96", "#5d9c3a", "#8a5a44", "#3b5aa8",
  "#c98a1d", "#2a9d8f", "#b5465e", "#6c757d",
];
const OTHER_COLOR = "#8e99a5";
// Lighten (>0) / darken (<0) steps for children of an expanded item, alternating so neighbours differ.
const SHADE_STEPS = [0, 0.42, -0.3, 0.62, 0.2, -0.16, 0.52, 0.08, -0.24, 0.32];
const SVGNS = "http://www.w3.org/2000/svg";

// The default view reproduces the reference chart: 养老保险基金补助 split into its 项.
const DEFAULTS = {
  path: ["社会保障和就业支出"], expanded: ["财政对基本养老保险基金的补助"],
  topN: 9, metric: "actual", share: false, fold: true, order: "sum", dir: "bottom",
};
const state = structuredClone(DEFAULTS);
let YEARS = [];
const INDEX = new Map(); // year -> Map(keyPath string -> aggregated node)

const $ = (id) => document.getElementById(id);

// ---------- data ----------

// Several source names can share one key (renamed or merged items), so nodes are merged by key.
function mergeInto(target, node) {
  for (const k of ["budget", "adjusted_budget", "actual"]) {
    if (node[k] != null) target[k] = (target[k] || 0) + node[k];
  }
  if (!target.names.includes(node.name)) target.names.push(node.name);
}

function buildIndex(data) {
  for (const y of data) {
    const map = new Map();
    const add = (node, keyPath) => {
      const id = keyPath.join("/");
      let agg = map.get(id);
      if (!agg) {
        agg = { key: keyPath[keyPath.length - 1], names: [], budget: null, adjusted_budget: null, actual: null, childKeys: [] };
        map.set(id, agg);
      }
      mergeInto(agg, node);
      for (const c of node.children || []) {
        if (!agg.childKeys.includes(c.key)) agg.childKeys.push(c.key);
        add(c, keyPath.concat(c.key));
      }
    };
    const t = y.total;
    const root = { key: TOTAL, names: [TOTAL], budget: t.budget, adjusted_budget: t.adjusted_budget, actual: t.actual, childKeys: [] };
    map.set("", root);
    for (const c of y.categories) {
      root.childKeys.push(c.key);
      add(c, [c.key]);
    }
    INDEX.set(y.year, map);
  }
  YEARS = data.map((y) => y.year);
}

function lookup(year, path) {
  return INDEX.get(year).get(path.join("/"));
}

function val(node, metric) {
  return node ? node[metric] || 0 : 0;
}

function childKeysAcrossYears(path) {
  const keys = [];
  for (const y of YEARS) {
    const p = lookup(y, path);
    if (p) for (const k of p.childKeys) if (!keys.includes(k)) keys.push(k);
  }
  return keys;
}

function shortLabel(key) {
  const m = key.match(/^财政对(.+)的补助$/);
  return m ? `${m[1]}补助` : key;
}

// Catch-all items such as "其他社会保障和就业支出" carry no meaning of their own.
function isCatchAll(key) {
  return key.startsWith("其他");
}

// ---------- layout ----------

/** Children of `path`: the topN largest (by total across years) plus the remainder. */
function pickChildren(path) {
  const { metric, fold, topN } = state;
  const items = childKeysAcrossYears(path).map((key, idx) => {
    const values = YEARS.map((y) => val(lookup(y, path.concat(key)), metric));
    return { key, idx, path: path.concat(key), values, sum: values.reduce((a, b) => a + b, 0) };
  }).filter((it) => it.sum > 0);
  const pool = fold ? items.filter((it) => !isCatchAll(it.key)) : items;
  const shown = pool.slice().sort((a, b) => b.sum - a.sum).slice(0, topN);
  const parents = YEARS.map((y) => val(lookup(y, path), metric));
  const rest = parents.map((p, j) => Math.max(0, p - shown.reduce((a, s) => a + s.values[j], 0)));
  return { shown, rest: rest.some((v) => v >= 0.5) ? rest : null, parents };
}

function score(it) {
  switch (state.order) {
    case "last": return it.values[it.values.length - 1];
    case "growth": {
      const first = it.values.find((v) => v > 0) || 0;
      const last = it.values[it.values.length - 1];
      return first ? last / first : 0;
    }
    case "source": return -it.idx;
    default: return it.sum;
  }
}

/** Returns bottom-to-top order. "Leading" items (highest score) go to the bottom or top per state.dir. */
function arrange(items, remainder) {
  const sorted = items.slice().sort((a, b) => score(b) - score(a));
  const bottomUp = state.dir === "bottom" ? sorted : sorted.reverse();
  // 其他 always sits at the small end.
  if (remainder) state.dir === "bottom" ? bottomUp.push(remainder) : bottomUp.unshift(remainder);
  return bottomUp;
}

function mix(hex, t) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const target = t >= 0 ? 255 : 0;
  const out = c.map((v) => Math.round(v + (target - v) * Math.abs(t)));
  return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("");
}

function mixGray(hex, t) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(OTHER_COLOR.slice(1), 16);
  const ch = (x, s) => (x >> s) & 255;
  const out = [16, 8, 0].map((s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t));
  return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("");
}

function canExpand(path) {
  return childKeysAcrossYears(path).length > 0;
}

/**
 * Builds the stack (bottom-to-top) for the current view. An expanded item is replaced by its
 * children in the same slot, coloured as shades of the item's own colour, so the parent stays
 * recognisable after expansion.
 */
function layout() {
  const path = state.path;
  const top = pickChildren(path);
  const colorOf = new Map(top.shown.slice().sort((a, b) => b.sum - a.sum).map((it, i) => [it.key, PALETTE[i % PALETTE.length]]));
  const remainder = top.rest && { key: OTHER, label: OTHER, values: top.rest, sum: 0, isOther: true, color: OTHER_COLOR };
  const series = [];
  const groups = [];

  for (const it of arrange(top.shown, remainder)) {
    if (it.isOther) { series.push({ ...it, id: OTHER }); continue; }
    const color = colorOf.get(it.key);
    const expandable = canExpand(it.path);
    if (expandable && state.expanded.includes(it.key)) {
      const sub = pickChildren(it.path);
      if (sub.shown.length) {
        const ranks = new Map(sub.shown.slice().sort((a, b) => b.sum - a.sum).map((c, i) => [c.key, i]));
        const subRest = sub.rest && { key: OTHER, label: `${OTHER}（${shortLabel(it.key)}）`, values: sub.rest, sum: 0, isOther: true };
        const group = { key: it.key, label: shortLabel(it.key), color, values: it.values, start: series.length };
        for (const c of arrange(sub.shown, subRest)) {
          series.push({
            ...c,
            id: `${it.key}/${c.key}`,
            label: c.label || shortLabel(c.key),
            color: c.isOther ? mixGray(color, 0.55) : mix(color, SHADE_STEPS[ranks.get(c.key) % SHADE_STEPS.length]),
            group,
          });
        }
        group.end = series.length - 1;
        groups.push(group);
        continue;
      }
    }
    series.push({ ...it, id: it.key, label: shortLabel(it.key), color, expandable });
  }
  return { series, groups, parents: top.parents };
}

// ---------- rendering ----------

function fmt(v) {
  if (v == null) return "–";
  const a = Math.abs(v);
  if (a >= 100) return Math.round(v).toLocaleString("zh-CN");
  if (a >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

function pct(v, digits = 1) {
  return v == null || !isFinite(v) ? "–" : `${v.toFixed(digits)}%`;
}

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

function labelColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 165 ? "#222" : "#fff";
}

function onSegmentClick(s) {
  if (s.group) collapse(s.group.key);
  else if (s.expandable) { state.expanded = state.expanded.concat(s.key); sync(); }
}

function collapse(key) {
  state.expanded = state.expanded.filter((k) => k !== key);
  sync();
}

function render() {
  const { share, metric } = state;
  const { series, groups, parents } = layout();
  currentSeries = series;
  const title = `${state.path[0] || TOTAL}主要类别金额`;
  $("title").textContent = title;
  document.title = `${title} · 2017–2025`;

  const W = 1200, H = 760;
  const m = { top: 70, right: 270, bottom: 40, left: 16 };
  const pw = W - m.left - m.right, ph = H - m.top - m.bottom;
  const n = YEARS.length;
  const slot = pw / n, bw = slot * 0.6;
  const x0 = (i) => m.left + i * slot + (slot - bw) / 2;
  const maxV = share ? 100 : Math.max(...parents, 1);
  const y = (v) => m.top + ph - (v / maxV) * ph;
  const scaled = (raw, j) => (share ? (parents[j] ? (raw / parents[j]) * 100 : 0) : raw);

  const stacks = series.map(() => []);
  for (let j = 0; j < n; j++) {
    let acc = 0;
    series.forEach((s, i) => {
      const v = scaled(s.values[j], j);
      stacks[i].push({ lo: acc, hi: acc + v, raw: s.values[j] });
      acc += v;
    });
  }

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, "aria-label": title });
  const gBands = el("g", {}, svg), gBars = el("g", {}, svg), gFrames = el("g", {}, svg), gText = el("g", {}, svg);

  series.forEach((s, i) => {
    const clickable = s.group || s.expandable;
    const g = el("g", { class: "seg" + (clickable ? " drill" : ""), "data-i": i }, gBars);
    const gb = el("g", { class: "band-group", "data-i": i }, gBands);
    for (let j = 0; j < n; j++) {
      const st = stacks[i][j];
      const top = y(st.hi), bot = y(st.lo);
      const rect = el("rect", { x: x0(j), y: top, width: bw, height: Math.max(0, bot - top), fill: s.color }, g);
      rect.dataset.j = j;
      if (j < n - 1) {
        const nx = stacks[i][j + 1];
        el("polygon", {
          class: "band",
          points: `${x0(j) + bw},${top} ${x0(j + 1)},${y(nx.hi)} ${x0(j + 1)},${y(nx.lo)} ${x0(j) + bw},${bot}`,
          fill: s.color,
        }, gb);
      }
      if (bot - top >= 15) {
        const t = el("text", {
          x: x0(j) + bw / 2, y: (top + bot) / 2 + 4.5, "text-anchor": "middle", "font-size": 12.5,
          fill: labelColor(s.color), "pointer-events": "none",
        }, gText);
        t.textContent = share ? pct(st.hi - st.lo) : fmt(st.raw);
      }
    }
    g.addEventListener("mousemove", (ev) => showTip(ev, s, +ev.target.dataset.j, parents));
    g.addEventListener("mouseenter", () => highlight(svg, s));
    g.addEventListener("mouseleave", () => { hideTip(); highlight(svg, null); });
    if (clickable) g.addEventListener("click", () => onSegmentClick(s));
  });

  // Frame each expanded group so its children read as one block.
  for (const gr of groups) {
    const stroke = mix(gr.color, -0.35);
    for (let j = 0; j < n; j++) {
      const top = y(stacks[gr.end][j].hi), bot = y(stacks[gr.start][j].lo);
      if (bot - top < 0.5) continue;
      el("rect", { x: x0(j) - 1.5, y: top - 1, width: bw + 3, height: bot - top + 2, fill: "none", stroke, "stroke-width": 2.5, "pointer-events": "none" }, gFrames);
    }
  }

  for (let j = 0; j < n; j++) {
    const top = y(share ? 100 : parents[j]);
    el("text", { x: x0(j) + bw / 2, y: top - 8, "text-anchor": "middle", "font-size": 17, "font-weight": 700, fill: "#333" }, gText).textContent = fmt(parents[j]);
    el("text", { x: x0(j) + bw / 2, y: H - 14, "text-anchor": "middle", "font-size": 15, "font-weight": 700, fill: "#222" }, gText).textContent = `${YEARS[j]}年`;
  }
  el("text", { x: m.left, y: 24, "font-size": 14, fill: "#555", "font-weight": 600 }, gText).textContent =
    share ? "单位：占当年合计 %" : `单位：亿元 · ${metric === "actual" ? "决算数" : "预算数"}`;
  el("text", { x: x0(n - 1) + bw + 8, y: y(share ? 100 : parents[n - 1]) - 8, "font-size": 13, fill: "#555" }, gText).textContent = "当年支出总额";

  drawLegend(svg, gText, series, groups, stacks, y, x0(n - 1) + bw, y(share ? 100 : parents[n - 1]) + 12, H - m.bottom);
  $("chart").replaceChildren(svg);
  renderTable(series, groups, parents);
}

function drawLegend(svg, g, series, groups, stacks, y, xEdge, yMin, yMax) {
  const n = YEARS.length;
  const lineH = 19;
  const items = series.map((s, i) => {
    const st = stacks[i][n - 1];
    return { s, i, want: (y(st.hi) + y(st.lo)) / 2 };
  });
  for (const gr of groups) {
    // Header sits just above the group's top child.
    items.push({ header: gr, want: y(stacks[gr.end][n - 1].hi) - 0.1 });
  }
  items.sort((a, b) => a.want - b.want);
  let prev = yMin - lineH;
  for (const it of items) { it.y = Math.max(it.want, prev + lineH); prev = it.y; }
  let next = yMax + lineH / 2;
  for (let k = items.length - 1; k >= 0; k--) { items[k].y = Math.min(items[k].y, next - lineH); next = items[k].y; }

  const lx = xEdge + 18;
  const indent = 14;
  for (const it of items) {
    if (it.header) {
      const gr = it.header;
      const dark = mix(gr.color, -0.35);
      const grp = el("g", { class: "legend", style: "cursor:pointer" }, g);
      const t = el("text", { x: lx, y: it.y + 4.5, "font-size": 13.5, "font-weight": 800, fill: dark }, grp);
      t.textContent = `${gr.label.length > 15 ? gr.label.slice(0, 14) + "…" : gr.label}（点击收起）`;
      el("title", {}, grp).textContent = `${gr.key}：点击收起`;
      grp.addEventListener("click", () => collapse(gr.key));
      const ys = items.filter((x) => x.s && x.s.group === gr).map((x) => x.y);
      el("path", { d: `M${lx + 4},${it.y + 8} L${lx + 4},${Math.max(...ys) + 8}`, stroke: dark, "stroke-width": 2.5 }, g);
      continue;
    }
    const s = it.s;
    const x = s.group ? lx + indent : lx;
    const name = s.label.length > 15 ? s.label.slice(0, 14) + "…" : s.label;
    const grp = el("g", { class: "legend", style: s.group || s.expandable ? "cursor:pointer" : "" }, g);
    el("path", { d: `M${xEdge + 2},${it.want} L${lx - 4},${it.y}`, stroke: s.color, "stroke-width": 1, fill: "none", opacity: 0.7 }, grp);
    const bg = el("rect", { x: x - 3, y: it.y - 9, height: 18, rx: 2, fill: s.color }, grp);
    const t = el("text", { x, y: it.y + 4.5, "font-size": 13.5, "font-weight": 700, fill: labelColor(s.color) }, grp);
    t.textContent = name;
    el("title", {}, grp).textContent = s.key + (s.group ? `（属于 ${s.group.key}，点击收起）` : s.expandable ? "（点击展开）" : "");
    requestAnimationFrame(() => {
      try { bg.setAttribute("width", t.getComputedTextLength() + 6); } catch (_) { bg.setAttribute("width", name.length * 14 + 6); }
    });
    grp.addEventListener("click", () => onSegmentClick(s));
    grp.addEventListener("mouseenter", () => highlight(svg, s));
    grp.addEventListener("mouseleave", () => highlight(svg, null));
  }
}

let currentSeries = [];

function highlight(svg, s) {
  const i = currentSeries.indexOf(s);
  svg.querySelectorAll(".seg, .band-group").forEach((node) => {
    node.classList.toggle("dim", s != null && +node.dataset.i !== i);
  });
}

function showTip(ev, s, j, parents) {
  if (Number.isNaN(j)) return;
  const tip = $("tooltip");
  const v = s.values[j];
  const prev = j > 0 ? s.values[j - 1] : null;
  const node = s.isOther ? null : lookup(YEARS[j], s.path);
  const lines = [
    `<b>${s.isOther ? s.label : s.key}</b> · ${YEARS[j]}年`,
    `<span class="k">${state.metric === "actual" ? "决算数" : "预算数"}</span> ${fmt(v)} 亿元`,
    `<span class="k">占合计</span> ${pct(parents[j] ? (v / parents[j]) * 100 : null)}`,
  ];
  if (s.group) {
    const gv = s.group.values[j];
    lines.push(`<span class="k">属于</span> ${s.group.key}（占 ${pct(gv ? (v / gv) * 100 : null)}）`);
  }
  if (prev) lines.push(`<span class="k">同比</span> ${pct((v / prev - 1) * 100)}`);
  if (node && state.metric === "actual" && node.budget) {
    lines.push(`<span class="k">预算数</span> ${fmt(node.budget)} · <span class="k">执行率</span> ${pct((node.actual / node.budget) * 100)}`);
  }
  if (node && (node.names.length > 1 || node.names[0] !== s.key)) {
    lines.push(`<span class="k">原表名称</span> ${node.names.join("、")}`);
  }
  if (s.group) lines.push(`<span class="k">点击收起</span>`);
  else if (s.expandable) lines.push(`<span class="k">点击展开下一级</span>`);
  tip.innerHTML = lines.join("<br>");
  tip.hidden = false;
  const box = $("chart").getBoundingClientRect();
  let left = ev.clientX - box.left + 14;
  if (left + 290 > box.width) left = ev.clientX - box.left - 290;
  tip.style.left = `${left}px`;
  tip.style.top = `${ev.clientY - box.top + 14}px`;
}

function hideTip() { $("tooltip").hidden = true; }

function renderTable(series, groups, parents) {
  const cells = (vals) => vals.map((v) => `<td>${v ? v.toFixed(2) : "–"}</td>`).join("");
  const sw = (c) => `<span class="sw" style="background:${c}"></span>`;
  const head = `<tr><th>${state.path[0] || TOTAL}（自上而下，同图中顺序）</th>${YEARS.map((yr) => `<th>${yr}</th>`).join("")}</tr>`;
  const body = [];
  const seen = new Set();
  for (const s of series.slice().reverse()) {
    if (s.group && !seen.has(s.group)) {
      seen.add(s.group);
      body.push(`<tr class="group"><td>${sw(s.group.color)}${s.group.key}</td>${cells(s.group.values)}</tr>`);
    }
    const name = s.isOther ? s.label : s.key;
    body.push(`<tr class="${s.group ? "child" : ""}"><td>${sw(s.color)}${name}</td>${cells(s.values)}</tr>`);
  }
  body.push(`<tr class="total"><td>合计</td>${cells(parents)}</tr>`);
  $("table").innerHTML = `<table><thead>${head}</thead><tbody>${body.join("")}</tbody></table>`;
}

// ---------- controls & state ----------

function renderControls() {
  $("category").value = state.path[0] || "";
  $("topn").value = state.topN;
  $("topn-out").textContent = state.topN;
  $("share").checked = state.share;
  $("fold").checked = state.fold;
  $("metric").value = state.metric;
  $("order").value = state.order;
  $("dir").value = state.dir;
}

function fillCategorySelect() {
  const last = YEARS[YEARS.length - 1];
  const keys = lookup(last, []).childKeys.slice().sort((a, b) => val(lookup(last, [b]), "actual") - val(lookup(last, [a]), "actual"));
  $("category").innerHTML = `<option value="">全部（按类）</option>` + keys.map((k) => `<option value="${k}">${k}</option>`).join("");
}

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.has("p")) {
    const parts = h.get("p") ? h.get("p").split("/") : [];
    state.path = parts.slice(0, 1);
    // Older links pointed at a 款 directly; show it expanded instead.
    state.expanded = parts.length > 1 ? [parts[1]] : [];
  }
  if (h.has("e")) state.expanded = h.get("e") ? h.get("e").split("|") : [];
  if (h.has("n")) state.topN = Math.min(20, Math.max(3, +h.get("n") || 10));
  if (h.has("m")) state.metric = h.get("m") === "budget" ? "budget" : "actual";
  if (h.has("s")) state.share = h.get("s") === "1";
  if (h.has("f")) state.fold = h.get("f") !== "0";
  if (h.has("o") && ["sum", "last", "growth", "source"].includes(h.get("o"))) state.order = h.get("o");
  if (h.has("d")) state.dir = h.get("d") === "top" ? "top" : "bottom";
  if (state.path.length && !YEARS.some((yr) => lookup(yr, state.path))) state.path = [];
}

function sync() {
  renderControls();
  const h = new URLSearchParams({
    p: state.path.join("/"), e: state.expanded.join("|"), o: state.order, d: state.dir,
    n: state.topN, m: state.metric, s: state.share ? 1 : 0, f: state.fold ? 1 : 0,
  });
  history.replaceState(null, "", `#${h}`);
  hideTip();
  render();
}

async function main() {
  const data = await (await fetch("data.json")).json();
  buildIndex(data);
  fillCategorySelect();
  readHash();
  $("category").addEventListener("change", (e) => {
    state.path = e.target.value ? [e.target.value] : [];
    state.expanded = [];
    sync();
  });
  const bind = (id, fn) => $(id).addEventListener(id === "topn" ? "input" : "change", (e) => { fn(e.target); sync(); });
  bind("topn", (t) => (state.topN = +t.value));
  bind("metric", (t) => (state.metric = t.value));
  bind("share", (t) => (state.share = t.checked));
  bind("fold", (t) => (state.fold = t.checked));
  bind("order", (t) => (state.order = t.value));
  bind("dir", (t) => (state.dir = t.value));
  window.addEventListener("hashchange", () => { readHash(); sync(); });
  sync();
}

main();
