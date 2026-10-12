"use strict";

const TOTAL = "全国一般公共预算支出";
const OTHER = "其他";
const PALETTE = [
  "#f28e1c", "#2bb3e6", "#e23c52", "#7b2d8e", "#5a6fd6", "#1f8a80", "#4cc35a", "#9c7b3c",
  "#a46bd6", "#3d8ee8", "#c4572b", "#b8a92a", "#d85c96", "#5d9c3a", "#8a5a44", "#3b5aa8",
  "#c98a1d", "#2a9d8f", "#b5465e", "#6c757d",
];
const OTHER_COLOR = "#8e99a5";
const SVGNS = "http://www.w3.org/2000/svg";

const state = { path: ["社会保障和就业支出"], topN: 10, metric: "actual", share: false };
let YEARS = [];
const INDEX = new Map(); // year -> Map(keyPath string -> aggregated node)

const $ = (id) => document.getElementById(id);

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
        const cp = keyPath.concat(c.key);
        if (!agg.childKeys.includes(c.key)) agg.childKeys.push(c.key);
        add(c, cp);
      }
    };
    const root = { key: TOTAL, names: [TOTAL], ...pick(y.total), childKeys: [] };
    map.set("", root);
    for (const c of y.categories) {
      root.childKeys.push(c.key);
      add(c, [c.key]);
    }
    INDEX.set(y.year, map);
  }
  YEARS = data.map((y) => y.year);
}

function pick(n) {
  return { budget: n.budget, adjusted_budget: n.adjusted_budget, actual: n.actual };
}

function lookup(year, path) {
  return INDEX.get(year).get(path.join("/"));
}

function hasChildren(path) {
  return YEARS.some((y) => {
    const n = lookup(y, path);
    return n && n.childKeys.length > 0;
  });
}

function val(node, metric) {
  if (!node) return 0;
  return node[metric] || 0;
}

function seriesFor(path, metric, topN) {
  const keys = [];
  for (const y of YEARS) {
    const p = lookup(y, path);
    if (p) for (const k of p.childKeys) if (!keys.includes(k)) keys.push(k);
  }
  const all = keys.map((key) => {
    const values = YEARS.map((y) => val(lookup(y, path.concat(key)), metric));
    return { key, values, sum: values.reduce((a, b) => a + b, 0), drill: hasChildren(path.concat(key)) };
  }).filter((s) => s.sum > 0);
  all.sort((a, b) => b.sum - a.sum);

  const shown = all.slice(0, topN);
  const parents = YEARS.map((y) => val(lookup(y, path), metric));
  const other = YEARS.map((y, i) => Math.max(0, parents[i] - shown.reduce((a, s) => a + s.values[i], 0)));
  // Drop the remainder when it is only rounding noise.
  if (other.some((v) => v >= 0.5)) {
    shown.push({ key: OTHER, values: other, sum: other.reduce((a, b) => a + b, 0), drill: false, isOther: true });
  }
  shown.forEach((s, i) => (s.color = s.isOther ? OTHER_COLOR : PALETTE[i % PALETTE.length]));
  return { series: shown, parents, all };
}

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

function render() {
  const { path, metric, topN, share } = state;
  const { series, parents } = seriesFor(path, metric, topN);
  const title = path.length ? path[path.length - 1] : TOTAL;
  $("title").textContent = path.length ? `${title}主要类别金额` : `${TOTAL}主要类别金额`;
  document.title = `${$("title").textContent} · 2017–2025`;

  const W = 1200, H = 760;
  const m = { top: 70, right: 260, bottom: 40, left: 16 };
  const pw = W - m.left - m.right, ph = H - m.top - m.bottom;
  const n = YEARS.length;
  const slot = pw / n, bw = slot * 0.6;
  const x0 = (i) => m.left + i * slot + (slot - bw) / 2;
  const maxV = share ? 100 : Math.max(...parents, 1);
  const y = (v) => m.top + ph - (v / maxV) * ph;

  // Stack bottom-up: largest at the bottom, 其他 on top.
  const stacks = series.map(() => []);
  for (let j = 0; j < n; j++) {
    let acc = 0;
    series.forEach((s, i) => {
      const raw = s.values[j];
      const v = share ? (parents[j] ? (raw / parents[j]) * 100 : 0) : raw;
      stacks[i].push({ lo: acc, hi: acc + v, raw });
      acc += v;
    });
  }

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, "aria-label": $("title").textContent });
  const gBands = el("g", {}, svg), gBars = el("g", {}, svg), gText = el("g", {}, svg);

  series.forEach((s, i) => {
    const g = el("g", { class: "seg" + (s.drill ? " drill" : ""), "data-i": i }, gBars);
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
        t.textContent = share ? pct((st.hi - st.lo), 1) : fmt(st.raw);
      }
    }
    g.addEventListener("mousemove", (ev) => showTip(ev, s, +ev.target.dataset.j, parents));
    g.addEventListener("mouseleave", hideTip);
    g.addEventListener("mouseenter", () => highlight(svg, i));
    g.addEventListener("mouseleave", () => highlight(svg, null));
    if (s.drill) g.addEventListener("click", () => { state.path = path.concat(s.key); sync(); });
  });

  // Totals above bars and year labels.
  for (let j = 0; j < n; j++) {
    const top = y(share ? 100 : parents[j]);
    const t = el("text", { x: x0(j) + bw / 2, y: top - 8, "text-anchor": "middle", "font-size": 17, "font-weight": 700, fill: "#333" }, gText);
    t.textContent = fmt(parents[j]);
    const yl = el("text", { x: x0(j) + bw / 2, y: H - 14, "text-anchor": "middle", "font-size": 15, "font-weight": 700, fill: "#222" }, gText);
    yl.textContent = `${YEARS[j]}年`;
  }
  const unit = el("text", { x: m.left, y: 24, "font-size": 14, fill: "#555", "font-weight": 600 }, gText);
  unit.textContent = share ? "单位：占当年合计 %" : `单位：亿元 · ${metric === "actual" ? "决算数" : "预算数"}`;
  const tl = el("text", { x: x0(n - 1) + bw + 8, y: y(share ? 100 : parents[n - 1]) - 8, "font-size": 13, fill: "#555" }, gText);
  tl.textContent = "当年支出总额";

  // Start the legend below the "当年支出总额" label.
  const legendTop = y(share ? 100 : parents[n - 1]) + 12;
  drawLegend(gText, series, stacks, y, x0(n - 1) + bw, legendTop, H - m.bottom, (i) => {
    const s = series[i];
    if (s.drill) { state.path = path.concat(s.key); sync(); }
  }, (i) => highlight(svg, i));

  const chart = $("chart");
  chart.replaceChildren(svg);
  renderTable(series, parents, path);
}

function drawLegend(g, series, stacks, y, xEdge, yMin, yMax, onClick, onHover) {
  const n = YEARS.length;
  const lineH = 19;
  const items = series.map((s, i) => {
    const st = stacks[i][n - 1];
    return { i, want: (y(st.hi) + y(st.lo)) / 2, s };
  }).sort((a, b) => a.want - b.want);
  // Spread labels so they don't overlap, first downward then back up if they overflow.
  let prev = yMin - lineH;
  for (const it of items) { it.y = Math.max(it.want, prev + lineH); prev = it.y; }
  let next = yMax + lineH / 2;
  for (let k = items.length - 1; k >= 0; k--) {
    const it = items[k];
    it.y = Math.min(it.y, next - lineH);
    next = it.y;
  }
  const lx = xEdge + 22;
  for (const it of items) {
    const name = it.s.key.length > 16 ? it.s.key.slice(0, 15) + "…" : it.s.key;
    const grp = el("g", { class: "legend", style: it.s.drill ? "cursor:pointer" : "" }, g);
    el("path", { d: `M${xEdge + 2},${it.want} L${lx - 4},${it.y}`, stroke: it.s.color, "stroke-width": 1, fill: "none", opacity: 0.6 }, grp);
    const bg = el("rect", { x: lx - 3, y: it.y - 9, height: 18, rx: 2, fill: it.s.color }, grp);
    const t = el("text", { x: lx, y: it.y + 4.5, "font-size": 13.5, "font-weight": 700, fill: labelColor(it.s.color) }, grp);
    t.textContent = name;
    const tt = el("title", {}, grp);
    tt.textContent = it.s.key + (it.s.drill ? "（点击下钻）" : "");
    // Measure after insertion so the background fits the text.
    requestAnimationFrame(() => {
      try { bg.setAttribute("width", t.getComputedTextLength() + 6); } catch (_) { bg.setAttribute("width", name.length * 14 + 6); }
    });
    grp.addEventListener("click", () => onClick(it.i));
    grp.addEventListener("mouseenter", () => onHover(it.i));
    grp.addEventListener("mouseleave", () => onHover(null));
  }
}

function highlight(svg, i) {
  svg.querySelectorAll(".seg, .band-group").forEach((g) => {
    g.classList.toggle("dim", i != null && +g.dataset.i !== i);
  });
}

function showTip(ev, s, j, parents) {
  if (Number.isNaN(j)) return;
  const tip = $("tooltip");
  const v = s.values[j];
  const prev = j > 0 ? s.values[j - 1] : null;
  const node = s.isOther ? null : lookup(YEARS[j], state.path.concat(s.key));
  const lines = [
    `<b>${s.key}</b> · ${YEARS[j]}年`,
    `<span class="k">${state.metric === "actual" ? "决算数" : "预算数"}</span> ${fmt(v)} 亿元`,
    `<span class="k">占上级</span> ${pct(parents[j] ? (v / parents[j]) * 100 : null)}`,
  ];
  if (prev) lines.push(`<span class="k">同比</span> ${pct((v / prev - 1) * 100)}`);
  if (node && state.metric === "actual" && node.budget) {
    lines.push(`<span class="k">预算数</span> ${fmt(node.budget)} · <span class="k">执行率</span> ${pct((node.actual / node.budget) * 100)}`);
  }
  if (node && node.names.length && (node.names.length > 1 || node.names[0] !== s.key)) {
    lines.push(`<span class="k">原表名称</span> ${node.names.join("、")}`);
  }
  if (s.drill) lines.push(`<span class="k">点击查看下级</span>`);
  tip.innerHTML = lines.join("<br>");
  tip.hidden = false;
  const box = $("chart").getBoundingClientRect();
  let left = ev.clientX - box.left + 14, top = ev.clientY - box.top + 14;
  if (left + 290 > box.width) left = ev.clientX - box.left - 290;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function hideTip() { $("tooltip").hidden = true; }

function renderTable(series, parents, path) {
  const { all } = seriesFor(path, state.metric, Infinity);
  const colorOf = new Map(series.map((s) => [s.key, s.color]));
  const rows = all.slice();
  const listed = YEARS.map((_, j) => all.reduce((a, s) => a + s.values[j], 0));
  const unlisted = parents.map((p, j) => Math.max(0, p - listed[j]));
  const head = `<tr><th>${path.length ? path[path.length - 1] : TOTAL}</th>${YEARS.map((y) => `<th>${y}</th>`).join("")}</tr>`;
  const body = rows.map((s) => {
    const c = colorOf.get(s.key) || OTHER_COLOR;
    return `<tr><td><span class="sw" style="background:${c}"></span>${s.key}</td>${s.values.map((v) => `<td>${v ? v.toFixed(2) : "–"}</td>`).join("")}</tr>`;
  });
  if (unlisted.some((v) => v >= 0.5)) {
    body.push(`<tr><td><span class="sw" style="background:${OTHER_COLOR}"></span>未单独列出</td>${unlisted.map((v) => `<td>${v.toFixed(2)}</td>`).join("")}</tr>`);
  }
  body.push(`<tr class="total"><td>合计</td>${parents.map((v) => `<td>${v ? v.toFixed(2) : "–"}</td>`).join("")}</tr>`);
  $("table").innerHTML = `<table><thead>${head}</thead><tbody>${body.join("")}</tbody></table>`;
}

function renderControls() {
  const { path } = state;
  const crumbs = $("crumbs");
  const parts = [TOTAL].concat(path);
  crumbs.innerHTML = parts.map((p, i) => i === parts.length - 1
    ? `<span class="cur">${p}</span>`
    : `<a data-depth="${i}">${p}</a>`).join('<span class="sep">›</span>');
  crumbs.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => {
    state.path = path.slice(0, +a.dataset.depth);
    sync();
  }));
  $("category").value = path[0] || "";
  $("topn").value = state.topN;
  $("topn-out").textContent = state.topN;
  $("share").checked = state.share;
  // 项 rows carry no 预算数 in the source tables, so the budget view stops at 款.
  const budgetOk = path.length < 2;
  const opt = $("metric").querySelector('option[value="budget"]');
  opt.disabled = !budgetOk;
  if (!budgetOk && state.metric === "budget") state.metric = "actual";
  $("metric").value = state.metric;
}

function fillCategorySelect() {
  const last = YEARS[YEARS.length - 1];
  const root = lookup(last, []);
  const keys = root.childKeys.slice().sort((a, b) => val(lookup(last, [b]), "actual") - val(lookup(last, [a]), "actual"));
  const sel = $("category");
  sel.innerHTML = `<option value="">全部（按类）</option>` + keys.map((k) => `<option value="${k}">${k}</option>`).join("");
}

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.has("p")) state.path = h.get("p") ? h.get("p").split("/") : [];
  if (h.has("n")) state.topN = Math.min(20, Math.max(3, +h.get("n") || 10));
  if (h.has("m")) state.metric = h.get("m") === "budget" ? "budget" : "actual";
  if (h.has("s")) state.share = h.get("s") === "1";
  // Drop path segments that don't exist in the data.
  while (state.path.length && !YEARS.some((y) => lookup(y, state.path))) state.path.pop();
}

function sync() {
  renderControls();
  const h = new URLSearchParams({ p: state.path.join("/"), n: state.topN, m: state.metric, s: state.share ? 1 : 0 });
  history.replaceState(null, "", `#${h}`);
  hideTip();
  render();
}

async function main() {
  const data = await (await fetch("data.json")).json();
  buildIndex(data);
  fillCategorySelect();
  readHash();
  $("category").addEventListener("change", (e) => { state.path = e.target.value ? [e.target.value] : []; sync(); });
  $("topn").addEventListener("input", (e) => { state.topN = +e.target.value; sync(); });
  $("metric").addEventListener("change", (e) => { state.metric = e.target.value; sync(); });
  $("share").addEventListener("change", (e) => { state.share = e.target.checked; sync(); });
  window.addEventListener("hashchange", () => { readHash(); sync(); });
  sync();
}

main();
