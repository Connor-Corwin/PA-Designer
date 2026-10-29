/* PA Designer — UI, 3D scene, maps, optimizer and saving. Rooms come from js/rooms.js, speakers from js/speakers.js, the acoustic model from js/engine.js. */
const E = window.Engine, R = window.Rooms;
const $ = id => document.getElementById(id);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const deg = Math.PI / 180;
const clone = o => JSON.parse(JSON.stringify(o));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ft = v => `${(+v).toFixed(Math.abs(v) < 10 && v % 1 ? 1 : (v % 1 ? 1 : 0))}'`;
const LS = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } } };

// ---------- project state
const DEFAULT_SETTINGS = { band: "mid", lf: 63, range: 18, win: 10, prec: 5, thr: 5, goal: "even", showSeats: true, showLines: true, showWalls: true };
let P = null, geo = null;
function roomSpec(room) { if (room.shape === "fixed") { const pr = R.ROOM_PRESETS.find(p => p.id === room.preset); return pr.spec(); } return room; }
function newProject(presetId) {
  const pr = R.ROOM_PRESETS.find(p => p.id === presetId) || R.ROOM_PRESETS[0];
  const spec = pr.spec(), room = spec.shape === "fixed" ? { shape: "fixed", preset: pr.id } : spec;
  const g = R.buildRoom(spec);
  return { v: 2, name: pr.id === "rock-s14" ? "The Rock, Concept S14" : pr.label.split(",")[0], roomPreset: pr.id, room, groups: E.makeTemplate(pr.template, g), custom: [], settings: clone(DEFAULT_SETTINGS) };
}
function normalize(p) {
  p.settings = Object.assign(clone(DEFAULT_SETTINGS), p.settings || {}); p.custom = p.custom || []; p.groups = (p.groups || []).map(g => E.group(g));
  return p;
}
// undo
const undoStack = [];
function pushUndo(label) { undoStack.push({ label, s: JSON.stringify(P) }); if (undoStack.length > 25) undoStack.shift(); $("undoBtn").disabled = false; $("undoBtn").title = `Undo: ${label}`; }
function undo() { const u = undoStack.pop(); if (!u) return; P = JSON.parse(u.s); applyProject(); $("optNote").textContent = `Undid: ${u.label}.`; $("undoBtn").disabled = !undoStack.length; }
$("undoBtn").onclick = undo;

// ---------- three.js scene
const canvas = $("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
const scene = new THREE.Scene(); scene.background = new THREE.Color(css("--bg"));
const camera = new THREE.PerspectiveCamera(48, 1, .5, 1500);
const controls = new THREE.OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = .08; controls.maxPolarAngle = Math.PI * .495;
const W3 = (x, y, z) => new THREE.Vector3(x, z, -y);
scene.add(new THREE.HemisphereLight(0xdfe6ef, 0x1a1c20, .85));
const dl = new THREE.DirectionalLight(0xffffff, .55); dl.position.set(20, 60, 30); scene.add(dl);
const roomG = new THREE.Group(), walls = new THREE.Group(), rig = new THREE.Group(), lines = new THREE.Group(), marks = new THREE.Group();
scene.add(roomG, walls, rig, lines, marks);
let seats = null, heat = null, heatCanvas = document.createElement("canvas"), hctx = heatCanvas.getContext("2d"), heatTex = null, HM = null;
const disposeGroup = g => { g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map && o.material.map !== heatTex) o.material.map.dispose(); o.material.dispose(); } }); g.clear(); };

function buildRoomScene() {
  disposeGroup(roomG); disposeGroup(walls);
  const [x0, y0, x1, y1] = geo.bbox, bw = x1 - x0, bh = y1 - y0;
  // floor
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(geo.AUD.map(([x, y]) => new THREE.Vector2(x, y)))), new THREE.MeshLambertMaterial({ color: 0x24282e }));
  floor.rotation.x = -Math.PI / 2; roomG.add(floor);
  // heat map: a grid that follows the stadium risers
  const step = Math.max(.5, Math.max(bw, bh) / 170);
  HM = { x0, y0, bw, bh, step, w: Math.ceil(bw / step), h: Math.ceil(bh / step) };
  heatCanvas.width = HM.w; heatCanvas.height = HM.h;
  if (heatTex) heatTex.dispose();
  heatTex = new THREE.CanvasTexture(heatCanvas); heatTex.magFilter = THREE.LinearFilter; heatTex.minFilter = THREE.LinearFilter;
  const segX = Math.max(1, Math.round(bw / 1.5)), segY = Math.max(1, Math.round(bh / 1.5));
  const pg = new THREE.PlaneGeometry(bw, bh, segX, segY); pg.rotateX(-Math.PI / 2); pg.translate(x0 + bw / 2, 0, -(y0 + bh / 2));
  const pos = pg.attributes.position; for (let i = 0; i < pos.count; i++) pos.setY(i, geo.floorAt(pos.getX(i), -pos.getZ(i)) + .05);
  pg.computeVertexNormals();
  heat = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ map: heatTex, transparent: true, depthWrite: false })); roomG.add(heat);
  // stage
  const stage = new THREE.Mesh(new THREE.ExtrudeGeometry(new THREE.Shape(geo.STAGE.map(([x, y]) => new THREE.Vector2(x, y))), { depth: geo.stageH, bevelEnabled: false }), new THREE.MeshLambertMaterial({ color: 0x2e333a }));
  stage.rotation.x = -Math.PI / 2; roomG.add(stage);
  // FOH
  if (geo.FOH) { const [a, b, c, d] = geo.FOH, fz = geo.floorAt((a + c) / 2, (b + d) / 2);
    const m = new THREE.Mesh(new THREE.BoxGeometry(c - a, 1.17, d - b), new THREE.MeshLambertMaterial({ color: 0x343a42 })); m.position.copy(W3((a + c) / 2, (b + d) / 2, fz + .58)); roomG.add(m);
    const k = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1, c - a - 1), 1, 2.2), new THREE.MeshLambertMaterial({ color: 0x4a515b })); k.position.copy(W3((a + c) / 2, d - 1.6, fz + 2.6)); roomG.add(k); }
  // walls
  const P2 = geo.AUD, cx = P2.reduce((s, p) => s + p[0], 0) / P2.length, cy = P2.reduce((s, p) => s + p[1], 0) / P2.length;
  const mat = new THREE.MeshLambertMaterial({ color: 0x3a3f47, side: THREE.FrontSide, transparent: true, opacity: .55, depthWrite: false });
  for (let i = 0; i < P2.length; i++) {
    const [a0, b0] = P2[i], [a1, b1] = P2[(i + 1) % P2.length], len = Math.hypot(a1 - a0, b1 - b0); if (len < .1) continue;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, geo.ceil), mat), mx = (a0 + a1) / 2, my = (b0 + b1) / 2; m.position.copy(W3(mx, my, geo.ceil / 2));
    let nx = -(b1 - b0) / len, ny = (a1 - a0) / len; if ((cx - mx) * nx + (cy - my) * ny < 0) { nx = -nx; ny = -ny; }
    m.lookAt(W3(mx + nx, my + ny, geo.ceil / 2)); walls.add(m);
  }
  const edge = new THREE.LineBasicMaterial({ color: 0x59606b });
  for (const z of [.02, geo.ceil]) walls.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(P2.map(([x, y]) => W3(x, y, z))), edge));
  walls.visible = P.settings.showWalls;
  // seats
  if (seats) { scene.remove(seats); seats.geometry.dispose(); seats.material.dispose(); }
  const sg = new THREE.BoxGeometry(1.5, 2.6, 1.45); sg.translate(0, 1.3, 0);
  seats = new THREE.InstancedMesh(sg, new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, geo.seats.length));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1);
  geo.seats.forEach((s, i) => { e.set(0, s.r + Math.PI / 2, 0); q.setFromEuler(e); m4.compose(W3(s.x, s.y, s.z), q, sc); seats.setMatrixAt(i, m4); seats.setColorAt(i, new THREE.Color(0x777777)); });
  seats.count = geo.seats.length; seats.visible = P.settings.showSeats; scene.add(seats);
  camsFor();
}

// speakers
function buildRig(src) {
  disposeGroup(rig); disposeGroup(lines);
  const box = (dims, color, emissive) => { const [h, w, d] = dims; const m = new THREE.Mesh(new THREE.BoxGeometry(d, h * .97, w), new THREE.MeshLambertMaterial({ color: 0x1b1d20, emissive: new THREE.Color(color), emissiveIntensity: emissive })); return m; };
  const lineTo = (a, b, color, op = 1) => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color, transparent: op < 1, opacity: op })); rig.add(l); };
  const deck = (x, y) => R.inPoly(x, y, geo.STAGE) ? geo.stageH : geo.floorAt(x, y);
  const hung = new Map();
  for (const s of src.mid) {
    const m = box(s.box, s.g.color, s.m.type === "line" ? .18 : .32);
    m.position.copy(W3(s.x, s.y, s.z));
    m.rotation.order = "YZX"; m.rotation.y = Math.atan2(s.az[1], s.az[0]); m.rotation.z = -s.tiltDraw * deg; rig.add(m);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(s.box[1] * .9, s.box[0] * .85), new THREE.MeshBasicMaterial({ color: s.g.color })); face.position.set(s.box[2] / 2 + .01, 0, 0); face.rotation.y = Math.PI / 2; m.add(face);
    const key = `${s.g.id}:${s.x.toFixed(2)}:${s.y.toFixed(2)}`;
    const top = s.z + s.box[0] / 2; const k = hung.get(key); if (!k || top > k.top) hung.set(key, { s, top, bottom: Math.min(k ? k.bottom : 1e9, s.z - s.box[0] / 2) }); else k.bottom = Math.min(k.bottom, s.z - s.box[0] / 2);
    if (P.settings.showLines && P.settings.band === "mid") drawCoverage(s);
  }
  for (const s of src.sub) {
    for (let i = 0; i < s.n; i++) {
      const zc = s.g.z + s.box[0] * (i + .5), rev = s.card && i === 1;
      const m = box(s.box, s.g.color, .12); m.position.copy(W3(s.x, s.y, zc)); m.rotation.y = Math.atan2(s.az[1], s.az[0]) + (rev ? Math.PI : 0); rig.add(m);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(s.box[1] * .88, s.box[0] * .8), new THREE.MeshBasicMaterial({ color: rev ? 0x5a6170 : s.g.color })); face.position.set(s.box[2] / 2 + .01, 0, 0); face.rotation.y = Math.PI / 2; m.add(face);
    }
    const key = `${s.g.id}:${s.x.toFixed(2)}:${s.y.toFixed(2)}`; hung.set(key, { s, top: s.g.z + s.n * s.box[0], bottom: s.g.z });
  }
  // rigging, poles, brackets
  for (const { s, top, bottom } of hung.values()) {
    const mt = s.g.mount;
    if (mt === "flown") { lineTo(W3(s.x, s.y, geo.ceil), W3(s.x, s.y, top), 0x59606b); }
    else if (mt === "pole") { const z0 = deck(s.x, s.y); if (bottom > z0 + .2) { const c = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, bottom - z0, 8), new THREE.MeshLambertMaterial({ color: 0x8a93a3 })); c.position.copy(W3(s.x, s.y, (bottom + z0) / 2)); rig.add(c);
      const t = new THREE.Mesh(new THREE.ConeGeometry(.9, .3, 3), new THREE.MeshLambertMaterial({ color: 0x59606b })); t.position.copy(W3(s.x, s.y, z0 + .15)); rig.add(t); } }
    else if (mt === "wall") { lineTo(W3(s.x, s.y, top), W3(s.x - s.az[0] * 1.5, s.y - s.az[1] * 1.5, top + .5), 0x8a93a3); }
  }
}
function drawCoverage(s) {
  const isSmall = s.box[1] < .6;
  for (const sgn of [1, -1]) {
    const inwardRight = ((-s.az[1]) * s.inward) > 0 ? 1 : -1, half = (sgn === inwardRight) ? s.hIn : s.hOut;
    const a = sgn * half * deg, ca = Math.cos(a), sa = Math.sin(a), rx = -s.az[1], ry = s.az[0];
    const dx = s.az[0] * ca + rx * sa, dy = s.az[1] * ca + ry * sa, dz = -Math.tan(Math.max(1, s.down) * deg);
    const earZ = geo.floorAt(s.x, s.y) + E.EAR;
    let t = (earZ - s.z) / dz; if (!(t > 0) || t > 140) t = 140; if (isSmall) t = Math.min(t, 24);
    for (let u = 1; u < t; u += .5) if (!R.inPoly(s.x + dx * u, s.y + dy * u, geo.AUD)) { t = u; break; }
    const g = new THREE.BufferGeometry().setFromPoints([W3(s.x, s.y, s.z), W3(s.x + dx * t, s.y + dy * t, Math.max(earZ, s.z + dz * t))]);
    lines.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: s.g.color, transparent: true, opacity: isSmall ? .45 : .8 })));
  }
}

// ---------- color maps
function turbo(t) {
  t = Math.min(1, Math.max(0, t));
  const r = 34.61 + t * (1172.33 - t * (10793.56 - t * (33300.12 - t * (38394.49 - t * 14825.05))));
  const g = 23.31 + t * (557.33 + t * (1225.33 - t * (3574.96 - t * (1073.77 + t * 707.56))));
  const b = 27.2 + t * (3211.1 - t * (15327.97 - t * (27814 - t * (22569.18 - t * 6838.66))));
  return [Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b))];
}
const TSTOPS = [[0, [64, 196, 120]], [8, [111, 208, 140]], [15, [242, 193, 78]], [25, [242, 140, 70]], [40, [242, 90, 80]]];
function timeColor(ms) { for (let i = 1; i < TSTOPS.length; i++) { const [a, ca] = TSTOPS[i - 1], [b, cb] = TSTOPS[i]; if (ms <= b) { const t = (ms - a) / (b - a); return ca.map((v, k) => v + (cb[k] - v) * Math.max(0, t)); } } return TSTOPS[TSTOPS.length - 1][1]; }
let LO = 80, HI = 98;
function drawLegend() {
  const c = $("legC"), g = c.getContext("2d"), band = P.settings.band, ticks = [];
  for (let i = 0; i < c.width; i++) { const [r, gg, b] = band === "time" ? timeColor(i / (c.width - 1) * 40) : turbo(i / (c.width - 1)); g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`; g.fillRect(i, 0, 1, c.height); }
  if (band === "time") { for (const v of [0, 10, 20, 30, 40]) ticks.push(`<span>${v}${v === 40 ? "+" : ""}</span>`); $("legT").textContent = "Arrival spread, ms"; }
  else { const span = HI - LO, step = span > 18 ? 6 : 3; for (let v = LO; v <= HI + .01; v += step) ticks.push(`<span>${Math.round(v)}</span>`); $("legT").textContent = band === "mid" ? "dB SPL, 1–4 kHz, seated ear height" : `dB SPL at ${P.settings.lf} Hz, seated ear height`; }
  $("legTicks").innerHTML = ticks.join("");
}

// ---------- compute + paint
let SRC = { mid: [], sub: [] }, seatVals = null, weakSeats = null;
const inAud = (x, y) => R.inPoly(x, y, geo.AUD) && !R.inPoly(x, y, geo.STAGE);
function valueAt(x, y, z) {
  const b = P.settings.band;
  if (b === "mid") return E.midAt(SRC.mid, x, y, z);
  if (b === "lf") return E.lfAt(SRC.sub, x, y, z, P.settings.lf);
  return E.timeSpread(SRC.mid, x, y, z, P.settings.win).ms;
}
function compute(fast) {
  E.setCustom(P.custom);
  SRC = E.sources(P.groups, geo);
  buildRig(SRC);
  const band = P.settings.band, empty = band === "lf" ? !SRC.sub.length : !SRC.mid.length;
  if (empty) { hctx.clearRect(0, 0, HM.w, HM.h); heatTex.needsUpdate = true; seatVals = null; paintSeats(); setStats(); drawLegend(); return; }
  seatVals = geo.seats.map(s => valueAt(s.x, s.y, s.z + E.EAR));
  if (band !== "time") { HI = Math.ceil(Math.max(...seatVals)); LO = HI - P.settings.range; }
  drawLegend(); paintSeats(); setStats();
  const skip = fast ? 2 : 1;
  const img = hctx.createImageData(HM.w, HM.h), d = img.data;
  for (let j = 0; j < HM.h; j += skip) {
    const y = HM.y0 + HM.bh - (j + .5) * HM.step;
    for (let i = 0; i < HM.w; i += skip) {
      const x = HM.x0 + (i + .5) * HM.step;
      let c = null;
      if (inAud(x, y)) {
        const v = valueAt(x, y, geo.floorAt(x, y) + E.EAR);
        if (band === "time") c = timeColor(v);
        else { c = turbo((v - LO) / (HI - LO)); const bd = ((v % 3) + 3) % 3; if (bd < .18) c = c.map(q => q * .55); }
      }
      for (let jj = 0; jj < skip && j + jj < HM.h; jj++) for (let ii = 0; ii < skip && i + ii < HM.w; ii++) {
        const o = ((j + jj) * HM.w + i + ii) * 4; if (!c) { d[o + 3] = 0; continue; } d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 235;
      }
    }
  }
  hctx.putImageData(img, 0, 0); heatTex.needsUpdate = true;
}
function paintSeats() {
  const c = new THREE.Color(), band = P.settings.band, weak = weakSeats ? new Set(weakSeats) : null;
  geo.seats.forEach((_, i) => {
    if (!seatVals) c.set(0x555555);
    else { const [r, g, b] = band === "time" ? timeColor(seatVals[i]) : turbo((seatVals[i] - LO) / (HI - LO)); c.setRGB(r / 255, g / 255, b / 255); }
    if (weak && weak.has(i)) c.setRGB(1, 1, 1);
    seats.setColorAt(i, c);
  });
  if (seats.instanceColor) seats.instanceColor.needsUpdate = true;
}
const stat = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
const tone = (v, good, warn, hi) => `var(${(hi ? v >= good : v <= good) ? "--good" : (hi ? v >= warn : v <= warn) ? "--warn" : "--bad"})`;
function rowAvg(sv, rows) { let p = 0, n = 0; sv.forEach((v, i) => { if (rows.includes(geo.seats[i].row)) { p += 10 ** (v / 10); n++; } }); return n ? 10 * Math.log10(p / n) : NaN; }
function setStats() {
  const sv = seatVals, el = $("stats");
  if (!sv || !sv.length) { el.innerHTML = stat("Seats", geo.seats.length) + stat("Map", P.settings.band === "lf" ? "no subs" : "no speakers"); return; }
  if (P.settings.band === "time") {
    const sorted = [...sv].sort((a, b) => a - b), ok = sv.filter(v => v < 10).length / sv.length, echo = sv.filter(v => v >= 30).length;
    el.innerHTML = stat("Seats", geo.seats.length) + stat("Under 10 ms", `<span style="color:${tone(ok, .9, .75, true)}">${Math.round(ok * 100)}%</span>`)
      + stat("30 ms+", `<span style="color:${echo ? "var(--bad)" : "var(--good)"}">${echo}</span><small> seats</small>`) + stat("Median", `${sorted[sorted.length >> 1].toFixed(1)}<small> ms</small>`) + stat("Worst", `${sorted[sorted.length - 1].toFixed(0)}<small> ms</small>`);
    return;
  }
  const p = sv.map(v => 10 ** (v / 10)), avg = 10 * Math.log10(p.reduce((a, b) => a + b, 0) / p.length);
  const sorted = [...sv].sort((a, b) => a - b), med = sorted[sorted.length >> 1], mn = sorted[0], mx = sorted[sorted.length - 1];
  const within = sv.filter(v => Math.abs(v - med) <= 3).length / sv.length, spread = mx - mn;
  const front = rowAvg(sv, [0, 1, 2]), back = rowAvg(sv, [geo.rows - 1, geo.rows - 2, geo.rows - 3]);
  el.innerHTML = stat("Seats", geo.seats.length) + stat("Seat avg", `${avg.toFixed(1)}<small> dB</small>`) + stat("Min / max", `${mn.toFixed(0)}–${mx.toFixed(0)}`)
    + stat("Spread", `<span style="color:${tone(spread, 6, 10)}">${spread.toFixed(1)}</span><small> dB</small>`)
    + stat("Within ±3 dB", `<span style="color:${tone(within, .9, .75, true)}">${Math.round(within * 100)}%</span>`)
    + stat("Front 3 rows", `${front.toFixed(1)}<small> dB</small>`) + stat("Back 3 rows", `${back.toFixed(1)}<small> dB</small>`);
}
let pending = false, fullTimer = null;
function update(fast = false) {
  if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; compute(fast); }); }
  clearTimeout(fullTimer); if (fast) fullTimer = setTimeout(() => compute(false), 220);
  saveSoon(); refreshBom();
}

// ---------- small UI helpers
function el(tag, attrs = {}, html = "") { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === "class") e.className = v; else if (k.startsWith("on")) e[k] = v; else if (k.startsWith("aria-")) e.setAttribute(k, String(v)); else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v); } if (html) e.innerHTML = html; return e; }
function slider(label, get, set, min, max, step, fmt, after) {
  const id = "s" + Math.random().toString(36).slice(2, 9);
  const w = el("label", { class: "row" }); w.append(document.createTextNode(label + " "));
  const out = el("output"); const inp = el("input", { type: "range", min, max, step, id, "aria-label": label });
  const v0 = get(); inp.value = v0; out.textContent = fmt(v0);
  inp.oninput = () => { const v = +inp.value; set(v); out.textContent = fmt(v); if (after) after(v); update(true); };
  inp.onchange = () => update(false);
  w.append(out, inp); return w;
}
function numRow(label, get, set, min, max, step, after) {
  const w = el("label", { class: "row num" }, `<span>${esc(label)}</span>`);
  const inp = el("input", { type: "number", min, max, step, value: get(), "aria-label": label });
  inp.oninput = () => { const v = Math.min(max, Math.max(min, +inp.value || 0)); set(v); if (after) after(v); update(); };
  w.append(inp); return w;
}
function selectEl(opts, val, onchange, label) {
  const s = el("select", { "aria-label": label || "" });
  for (const o of opts) { if (o.group) { const og = el("optgroup", { label: o.group }); for (const x of o.items) og.append(el("option", { value: x.v }, esc(x.t))); s.append(og); } else s.append(el("option", { value: o.v }, esc(o.t))); }
  s.value = val; s.onchange = () => onchange(s.value); return s;
}
function toggle(label, get, set) { const w = el("label", { class: "toggle" }); const i = el("input", { type: "checkbox" }); i.checked = !!get(); i.onchange = () => set(i.checked); w.append(i, document.createTextNode(" " + label)); return w; }

// ---------- tabs
document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => {
  document.querySelectorAll("[data-tab]").forEach(x => x.setAttribute("aria-selected", x === b));
  for (const t of ["room", "sys", "an", "file"]) $("pane-" + t).hidden = t !== b.dataset.tab;
});

// ---------- ROOM pane
function rebuildRoom(keepCam) {
  geo = R.buildRoom(roomSpec(P.room)); weakSeats = null; disposeGroup(marks); $("suggList").innerHTML = "";
  buildRoomScene(); if (!keepCam) setCam("3d");
  $("roomDesc").textContent = roomDesc(); update();
}
function roomDesc() {
  const sp = roomSpec(P.room);
  const shape = sp.shape === "fixed" ? "Fixed drawing" : sp.shape === "fan" ? "Fan" : "Rectangle";
  return `${shape}: ${Math.round(geo.W)}' × ${Math.round(geo.D)}', ${geo.ceil}' ceiling, ${geo.seats.length} seats.`;
}
function renderRoomCtl() {
  const host = $("roomCtl"); host.innerHTML = "";
  const room = P.room, sec = (title) => { const s = el("section", { class: "grp" }, `<h2>${title}</h2>`); host.append(s); return s; };
  const re = () => { clearTimeout(re.t); re.t = setTimeout(() => rebuildRoom(true), 60); };
  if (room.shape === "fixed") {
    const s = sec("This room");
    s.append(el("p", { class: "note" }, "This room is a fixed drawing, so its outline and seats can't be edited here. Make an editable copy to change the dimensions; it starts as a fan of about the same size."));
    s.append(el("button", { onclick: () => { pushUndo("make room editable"); P.room = R.merge({ shape: "fan", width: 44, backWidth: 64, depth: 86, ceiling: geo.ceil, stage: { depth: 22, width: 44, height: geo.stageH, curve: 6 }, seating: { rowRadius: 45, centerAisle: 0, sideAisle: 4, frontGap: 8, backGap: 6 }, foh: { on: true, width: 17, depth: 7.75, fromBack: 0.5 } }); rebuildRoom(true); renderRoomCtl(); } }, "Make an editable copy"));
    return;
  }
  const g = (path) => path.split(".").reduce((o, k) => o[k], room);
  const s = (path, v) => { const ks = path.split("."); let o = room; for (const k of ks.slice(0, -1)) o = o[k]; o[ks[ks.length - 1]] = v; };
  const sl = (label, path, min, max, step, f = ft) => slider(label, () => g(path), v => { s(path, v); re(); }, min, max, step, f);
  const inch = v => `${v}"`;
  const a = sec("Shape");
  const seg = el("div", { class: "seg seg3", role: "group", "aria-label": "Room shape" });
  for (const [v, t] of [["rect", "Rectangle"], ["fan", "Fan"]]) { const b = el("button", { "aria-pressed": room.shape === v }, t); b.onclick = () => { room.shape = v; if (v === "fan" && room.backWidth <= room.width) room.backWidth = Math.round(room.width * 1.6); rebuildRoom(true); renderRoomCtl(); }; seg.append(b); }
  seg.style.gridTemplateColumns = "1fr 1fr"; a.append(seg);
  a.append(sl(room.shape === "fan" ? "Width at the stage" : "Width", "width", 20, 160, 1));
  if (room.shape === "fan") a.append(sl("Width at the back", "backWidth", 20, 220, 1));
  a.append(sl("Depth, stage wall to back wall", "depth", 30, 220, 1), sl("Ceiling height", "ceiling", 10, 60, .5));
  const b = sec("Stage");
  b.append(sl("Depth at center", "stage.depth", 6, 50, .5), sl("Width", "stage.width", 10, 120, 1), sl("Height", "stage.height", 0, 6, .25), sl("Front curve (bulge at center)", "stage.curve", 0, 20, .5));
  const c = sec("Seating");
  c.append(sl("First row from stage", "seating.frontGap", 3, 30, .5), sl("Row spacing", "seating.rowSpacing", 30, 54, 1, inch), sl("Seat width", "seating.seatWidth", 18, 26, .5, inch),
    sl("Center aisle", "seating.centerAisle", 0, 12, .5), sl("Side aisles", "seating.sideAisle", 0, 12, .5), sl("Back aisle", "seating.backGap", 0, 40, .5),
    sl("Row curve radius (0 = straight)", "seating.rowRadius", 0, 200, 1, v => v ? ft(v) : "straight"), sl("Raised rows at the back", "seating.stadiumRows", 0, 15, 1, v => `${v}`), sl("Riser per row", "seating.riser", 6, 24, 1, inch));
  const d = sec("Sound booth");
  d.append(toggle("Booth in the seating", () => room.foh.on, v => { room.foh.on = v; re(); }), sl("Booth width", "foh.width", 6, 30, .5), sl("Booth depth", "foh.depth", 4, 20, .5), sl("Distance from back wall", "foh.fromBack", 0, 80, .5));
}
$("roomPreset").innerHTML = R.ROOM_PRESETS.map(p => `<option value="${p.id}">${esc(p.label)}</option>`).join("");
$("loadRoom").onclick = () => { pushUndo("load room"); const keep = { custom: P.custom, settings: P.settings }; P = Object.assign(newProject($("roomPreset").value), keep); applyProject(); };

// ---------- SYSTEM pane: speaker groups
const TYPE_LABEL = { line: "Line array", point: "Point source", sub: "Sub" };
const MOUNTS_FOR = { line: ["flown", "stack", "pole"], point: ["flown", "pole", "stack", "wall", "lip"], sub: ["flown", "stack"] };
function modelOptions(type, familyOf) {
  const ms = E.allModels().filter(m => m.type === type && (!familyOf || m.family === familyOf));
  const brands = [...new Set(ms.map(m => m.brand))];
  return brands.map(b => ({ group: b, items: ms.filter(m => m.brand === b).map(m => ({ v: m.id, t: m.model + (m.src ? "" : " *") })) }));
}
function unitCount(g) { return E.unitPositions(g, geo).length; }
function gSummary(g) {
  const t = E.groupType(g), n = unitCount(g), m = E.model(t === "line" ? g.boxes[0].m : g.model);
  const what = t === "line" ? `${n} × ${g.boxes.length}-box ${m.model}` : t === "sub" ? `${n} × ${g.subN} ${m.model} ${g.subN > 1 ? g.subMode : ""}` : `${n} × ${m.model}`;
  const where = g.mount === "lip" ? "stage front" : `${E.MOUNTS[g.mount].toLowerCase()} ${ft(g.z)}`;
  return `${what} · ${where} · ${g.gain} dB${g.delay ? ` · ${g.delay} ms` : ""}`;
}
function setType(g, type) {
  if (type === "line") { const m = E.allModels().find(x => x.type === "line" && x.id === "lac-kara2") || E.allModels().find(x => x.type === "line"); g.model = m.id; g.boxes = Array.from({ length: 6 }, (_, i) => ({ m: m.id, h: m.h[0].id, splay: m.splays.length > 1 ? m.splays[Math.min(m.splays.length - 1, i + 1)] : m.splays[0], trim: 0 })); if (g.mount === "lip" || g.mount === "wall") g.mount = "flown"; }
  else { g.boxes = []; g.model = E.allModels().find(x => x.type === type).id; if (!MOUNTS_FOR[type].includes(g.mount)) g.mount = MOUNTS_FOR[type][0]; }
  if (type === "sub") g.role = "sub"; else if (g.role === "sub") g.role = "main";
}
function setModel(g, id) {
  const m = E.model(id), t = E.groupType(g);
  if (t === "line") { g.model = id; g.boxes.forEach((b, i) => { b.m = id; if (!m.h.some(o => o.id === b.h)) b.h = m.h[0].id; if (m.splays.length > 1 && !m.splays.includes(b.splay)) b.splay = m.splays.reduce((p, q) => Math.abs(q - b.splay) < Math.abs(p - b.splay) ? q : p); }); }
  else { g.model = id; if (m.h && !m.h.some(o => o.id === g.hopt)) g.hopt = m.h[0].id; }
}
function renderGroups() {
  const host = $("groups"); host.innerHTML = "";
  if (!P.groups.length) host.append(el("p", { class: "note" }, "No speakers yet. Add a group below, or load a room with a starter system."));
  P.groups.forEach((g, gi) => host.append(groupCard(g, gi)));
}
function groupCard(g, gi) {
  const t = E.groupType(g), card = el("div", { class: "gcard" + (g.mute ? " muted" : "") });
  const head = el("div", { class: "ghead", role: "button", tabindex: 0, "aria-expanded": g.open });
  head.innerHTML = `<span class="chip" style="background:${g.color}"></span><div><div class="gname">${esc(g.name)} <span class="note">· ${E.ROLES[g.role]}</span></div><div class="gsub">${esc(gSummary(g))}</div></div>`;
  const mute = el("button", { class: "iconbtn", "aria-pressed": g.mute, title: "Mute this group" }, g.mute ? "Muted" : "Mute");
  mute.onclick = e => { e.stopPropagation(); g.mute = !g.mute; renderGroups(); update(); };
  const chev = el("span", { class: "note", "aria-hidden": "true" }, g.open ? "▾" : "▸");
  head.append(mute, chev);
  head.onclick = () => { g.open = !g.open; renderGroups(); };
  head.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); head.onclick(); } };
  card.append(head);
  if (!g.open) return card;
  const body = el("div", { class: "gbody" }); card.append(body);
  const refreshHead = () => { head.querySelector(".gsub").textContent = gSummary(g); };
  const S = (label, key, min, max, step, f, after) => slider(label, () => g[key], v => { g[key] = v; refreshHead(); if (after) after(v); }, min, max, step, f);
  const dB = v => `${v} dB`, dg = v => `${v}°`;
  // identity
  const nm = el("input", { type: "text", class: "txt", value: g.name, "aria-label": "Group name" }); nm.oninput = () => { g.name = nm.value; head.querySelector(".gname").firstChild.textContent = g.name + " "; saveSoon(); };
  body.append(el("div", { class: "twocol" })); body.lastChild.append(nm, selectEl(Object.entries(E.ROLES).map(([v, tt]) => ({ v, t: tt })), g.role, v => { g.role = v; renderGroups(); update(); }, "Role"));
  // speaker
  const ty = selectEl(Object.entries(TYPE_LABEL).map(([v, tt]) => ({ v, t: tt })), t, v => { setType(g, v); renderGroups(); update(); }, "Speaker type");
  const fam = t === "line" ? null : null;
  const md = selectEl(modelOptions(t, fam), t === "line" ? g.boxes[0].m : g.model, v => { setModel(g, v); renderGroups(); update(); }, "Model");
  body.append(el("div", { class: "twocol" })); body.lastChild.append(ty, md);
  const m = E.model(t === "line" ? g.boxes[0].m : g.model);
  body.append(el("p", { class: "note src" }, `${esc(m.brand)} ${esc(m.model)}: ${m.maxSpl} dB peak${m.type === "point" ? `, ${m.h.map(o => o.label).join(" / ")} × ${m.v}°${m.rot ? ", rotatable horn" : ""}` : m.type === "line" ? `, ${m.h.map(o => o.label).join(" / ")}, splay ${m.splays.length > 1 ? `${m.splays[0]}–${m.splays[m.splays.length - 1]}°` : `fixed ${m.splays[0]}°`}` : ""}. ${m.src ? `<a href="${esc(m.src)}" target="_blank" rel="noopener">Spec source</a>` : `<span class="flag">* Typical published spec, not re-checked; confirm on the datasheet.</span>`}`));
  // mounting + layout
  body.append(el("div", { class: "ctlhead" }, "Mounting"));
  body.append(selectEl(MOUNTS_FOR[t].map(v => ({ v, t: E.MOUNTS[v] })), g.mount, v => { g.mount = v; if (v === "stack") g.z = 0; if (v === "pole" && g.z < 4) g.z = 6.5; renderGroups(); update(); }, "Mounting"));
  body.append(toggle("Mirror left / right", () => g.mirror, v => { g.mirror = v; renderGroups(); update(); }));
  const nsel = selectEl(Array.from({ length: 12 }, (_, i) => ({ v: String(i + 1), t: i ? `${i + 1} in a row` : "1 unit" })), String(g.layout === "row" ? g.n : 1), v => { g.n = +v; g.layout = g.n > 1 ? "row" : "single"; if (g.n > 1 && !g.spread) g.spread = Math.min(geo.W * .6, g.n * 8); renderGroups(); update(); }, "Units");
  body.append(el("label", { class: "row" }, "Units per side")); body.lastChild.append(nsel);
  if (g.layout === "row" && g.n > 1) body.append(S("Row width", "spread", 1, Math.round(geo.W), .5, ft));
  // position
  body.append(el("div", { class: "ctlhead" }, "Position"));
  body.append(S(g.mirror ? "Distance from center line (each side)" : "From center line (+ = house right)", "off", g.mirror ? 0 : -Math.round(geo.W / 2), Math.round(geo.W / 2), .25, ft));
  if (g.mount !== "lip") {
    body.append(S("From stage front (− = over the stage)", "dist", -Math.round(geo.D - geo.lipC), Math.round(geo.lipC), .25, ft));
    body.append(S(t === "line" ? "Bottom of the array, above the floor" : "Bottom of the speaker, above the floor", "z", 0, Math.floor(geo.ceil), .25, ft));
  }
  // aim
  body.append(el("div", { class: "ctlhead" }, "Aim"));
  body.append(S(g.mirror || Math.abs(g.off) > .01 ? "Toe-in toward center" : "Pan (+ = toward house left)", "pan", -60, 60, .5, dg));
  body.append(S(t === "line" ? "Site angle, top box (+ = down)" : "Tilt (+ = down)", "tilt", -30, 60, .5, dg));
  if (t === "point") {
    if (m.h.length > 1) body.append(selectEl(m.h.map(o => ({ v: o.id, t: `Horizontal ${o.label}` })), g.hopt || m.h[0].id, v => { g.hopt = v; update(); }, "Horizontal"));
    if (m.rot) body.append(toggle(`Rotate horn (${m.v}° wide, ${m.h[0].in + m.h[0].out}° tall)`, () => g.rot, v => { g.rot = v; renderGroups(); update(); }));
  }
  if (t === "line") body.append(boxList(g, m));
  if (t === "sub") {
    body.append(el("div", { class: "ctlhead" }, "Sub stack"));
    body.append(el("label", { class: "row" }, "Boxes per stack")); body.lastChild.append(selectEl([1, 2, 3, 4, 5, 6].map(n => ({ v: String(n), t: String(n) })), String(g.subN), v => { g.subN = +v; renderGroups(); update(); }, "Boxes per stack"));
    body.append(el("label", { class: "row" }, "Pattern")); body.lastChild.append(selectEl([{ v: "cardioid", t: "Cardioid (one box reversed)" }, { v: "omni", t: "Omni (all forward)" }], g.subMode, v => { g.subMode = v; renderGroups(); update(); }, "Pattern"));
    if (g.subMode === "cardioid" && g.subN < 2) body.append(el("p", { class: "note warn" }, "Cardioid needs at least 2 boxes, so this runs omni."));
  }
  // level + time
  body.append(el("div", { class: "ctlhead" }, "Level and time"));
  body.append(S("Level", "gain", -40, 6, .5, dB));
  const dr = el("div", { class: "dlyrow" }, "<span>Delay, ms</span>");
  const di = el("input", { type: "number", min: 0, max: 500, step: .1, value: g.delay, "aria-label": "Delay in ms" });
  di.oninput = () => { g.delay = Math.max(0, +di.value || 0); refreshHead(); update(); };
  const ab = el("button", { title: "Time this group to the mains" }, "Auto");
  ab.onclick = () => { const r = E.autoDelay(P.groups, geo, g, P.settings.prec); if (r.ok) { pushUndo(`auto delay ${g.name}`); g.delay = r.ms; di.value = r.ms; refreshHead(); update(); } dnote.textContent = r.ok ? `Set to ${r.ms} ms from ${r.seats} seats. ${r.msg || ""}` : r.msg; };
  dr.append(di, ab); body.append(dr);
  const dnote = el("p", { class: "note" }); body.append(dnote);
  body.append(toggle("Polarity inverted", () => g.polarity < 0, v => { g.polarity = v ? -1 : 1; update(); }));
  body.append(toggle("Lock (Optimize leaves this group alone)", () => g.lock, v => { g.lock = v; }));
  const foot = el("div", { class: "gfoot" });
  foot.append(el("button", { onclick: () => { pushUndo("duplicate group"); const c = clone(g); c.id = E.newId(); c.name = g.name + " copy"; c.color = nextColor(); P.groups.splice(gi + 1, 0, c); renderGroups(); update(); } }, "Duplicate"));
  if (gi > 0) foot.append(el("button", { onclick: () => { P.groups.splice(gi - 1, 0, P.groups.splice(gi, 1)[0]); renderGroups(); saveSoon(); } }, "Move up"));
  foot.append(el("button", { class: "danger", onclick: () => { pushUndo(`delete ${g.name}`); P.groups.splice(gi, 1); renderGroups(); update(); } }, "Delete"));
  body.append(foot);
  return card;
}
function boxList(g, m) {
  const wrap = el("div", { class: "boxes" });
  wrap.append(el("div", { class: "ctlhead" }, `Boxes, top to bottom (${g.boxes.length})`));
  const fam = E.allModels().filter(x => x.type === "line" && x.family === m.family);
  let total = 0;
  g.boxes.forEach((b, i) => {
    const bm = E.model(b.m), cc = bm.splays.length === 1;
    const row = el("div", { class: "box" + (cc ? " cc" : "") });
    row.append(el("span", { class: "n" }, String(i + 1)));
    row.append(fam.length > 1 ? selectEl(fam.map(x => ({ v: x.id, t: x.model.replace(/^.* /, "") })), b.m, v => { b.m = v; const nm = E.model(v); if (!nm.h.some(o => o.id === b.h)) b.h = nm.h[0].id; renderGroups(); update(); }, `Box ${i + 1} model`) : el("span", { class: "note" }, esc(bm.model)));
    row.append(bm.h.length > 1 ? selectEl(bm.h.map(o => ({ v: o.id, t: o.label })), b.h, v => { b.h = v; update(); }, `Box ${i + 1} horizontal`) : el("span", { class: "note" }, bm.h[0].label));
    if (!cc) row.append(selectEl(bm.splays.map(s => ({ v: String(s), t: `${s}°` })), String(b.splay), v => { b.splay = +v; renderGroups(); update(); }, `Box ${i + 1} splay to the next box`));
    const tr = el("input", { type: "number", min: -12, max: 6, step: .5, value: b.trim || 0, "aria-label": `Box ${i + 1} level trim, dB`, title: "Trim, dB" });
    tr.oninput = () => { b.trim = +tr.value || 0; update(); }; row.append(tr);
    wrap.append(row); total += cc ? bm.splays[0] : b.splay;
  });
  wrap.append(el("p", { class: "note" }, `Total array curve ${total.toFixed(1)}°, from ${g.tilt}° to ${(g.tilt + total).toFixed(1)}° down. Columns: ${fam.length > 1 ? "box type, " : ""}horizontal, ${m.splays.length > 1 ? "splay to the next box, " : ""}trim (dB).`));
  const ar = el("div", { class: "gfoot" });
  ar.append(el("button", { onclick: () => { if (g.boxes.length >= 24) return; g.boxes.push(clone(g.boxes[g.boxes.length - 1])); renderGroups(); update(); } }, "Add box"));
  ar.append(el("button", { disabled: g.boxes.length <= 1, onclick: () => { g.boxes.pop(); renderGroups(); update(); } }, "Remove bottom box"));
  wrap.append(ar);
  return wrap;
}
function nextColor() { const used = P.groups.map(g => g.color); return E.COLORS.find(c => !used.includes(c)) || E.COLORS[P.groups.length % E.COLORS.length]; }
function addGroup(kind) {
  const hw = Math.max(6, Math.min(geo.stageW / 2, geo.W / 2 - 4)), hasMain = P.groups.some(g => g.role === "main"), z = Math.max(12, Math.min(geo.ceil - 5, 26));
  const base = { color: nextColor(), open: true };
  const kara = n => Array.from({ length: n }, (_, i) => ({ m: "lac-kara2", h: "110", splay: [1, 2, 3, 5, 7.5, 10, 10, 10][Math.min(7, i)], trim: 0 }));
  const G = o => E.group(Object.assign({}, base, o));
  let g;
  if (kind === "line") g = G({ name: hasMain ? "Line array" : "Mains", role: hasMain ? "outfill" : "main", model: "lac-kara2", boxes: kara(6), mirror: true, off: hw + 1, dist: 1, z, pan: 8, tilt: 2, gain: -14 });
  if (kind === "point") g = G({ name: hasMain ? "Point sources" : "Mains", role: hasMain ? "outfill" : "main", model: "qsc-k122", mount: "pole", mirror: true, off: hw - 1.5, dist: 1.5, z: 6.5, pan: 10, gain: -12 });
  if (kind === "center") g = G({ name: "Center cluster", role: "main", model: "lac-kara2", boxes: kara(6), off: 0, dist: 1, z: Math.min(geo.ceil - 4, z + 2), tilt: 4, gain: -14 });
  if (kind === "fill") g = G({ name: "Front fills", role: "fill", model: "lac-x4i", mount: "lip", layout: "row", n: 4, spread: geo.stageW * .6, tilt: -8, gain: -10 });
  if (kind === "outfill") g = G({ name: "Out-fills", role: "outfill", model: "gen-point-90x60", mount: "flown", mirror: true, off: Math.min(geo.W / 2 - 3, hw + 8), dist: 2, z: Math.min(geo.ceil - 3, 16), pan: -30, tilt: 12, gain: -16 });
  if (kind === "delay") g = G({ name: "Delays", role: "delay", model: "gen-point-90x60", mount: "flown", layout: "row", n: 2, spread: geo.W * .45, dist: Math.round(geo.lipC * .55), z: Math.min(geo.ceil - 3, 14), tilt: 15, gain: -14 });
  if (kind === "sub") g = G({ name: "Subs", role: "sub", model: "lac-ks21", mount: "stack", mirror: true, off: hw - 2, dist: 2, z: 0, subN: 2, subMode: "cardioid", gain: -18 });
  if (kind === "subrow") g = G({ name: "Sub array", role: "sub", model: "lac-ks21", mount: "stack", layout: "row", n: 4, spread: geo.stageW * .7, dist: 1.5, z: 0, subN: 1, subMode: "omni", gain: -18 });
  pushUndo("add group"); P.groups.forEach(x => x.open = false); P.groups.push(g);
  if (kind === "delay" || kind === "fill" || kind === "outfill") { const r = E.autoDelay(P.groups, geo, g, P.settings.prec); if (r.ok) g.delay = r.ms; }
  renderGroups(); update();
}
$("addGroup").onclick = () => addGroup($("addKind").value);

// custom speaker form
function renderCustomForm() {
  const f = $("customForm"); f.innerHTML = "";
  const st = { brand: "Custom", model: "My speaker", type: "point", hdeg: 90, v: 60, maxSpl: 130, h: 600, w: 380, d: 380, splayMax: 10 };
  const txt = (label, k) => { const w = el("label", { class: "row num" }, `<span>${label}</span>`); const i = el("input", { type: "text", class: "txt", value: st[k] }); i.oninput = () => st[k] = i.value; w.style.gridTemplateColumns = "1fr 150px"; w.append(i); return w; };
  const num = (label, k, min, max, step) => { const w = el("label", { class: "row num" }, `<span>${label}</span>`); const i = el("input", { type: "number", min, max, step, value: st[k] }); i.oninput = () => st[k] = +i.value; w.append(i); return w; };
  f.append(txt("Brand", "brand"), txt("Model", "model"));
  f.append(el("label", { class: "row" }, "Type")); f.lastChild.append(selectEl([{ v: "point", t: "Point source" }, { v: "line", t: "Line-array element" }, { v: "sub", t: "Sub" }], st.type, v => { st.type = v; }, "Type"));
  f.append(num("Horizontal coverage, °", "hdeg", 10, 180, 1), num("Vertical coverage, ° (point)", "v", 5, 180, 1), num("Max splay, ° (line)", "splayMax", 1, 20, .5), num("Peak max SPL, dB", "maxSpl", 90, 160, .5), num("Height, mm", "h", 50, 2000, 1), num("Width, mm", "w", 50, 2000, 1), num("Depth, mm", "d", 50, 2000, 1));
  f.append(el("button", { class: "primary", onclick: () => {
    const id = "custom-" + Date.now().toString(36), h = [{ id: String(st.hdeg), label: `${st.hdeg}°`, in: st.hdeg / 2, out: st.hdeg / 2 }];
    const m = { id, brand: st.brand || "Custom", model: st.model || "Speaker", type: st.type, maxSpl: st.maxSpl, dims: [st.h, st.w, st.d], h, src: null, custom: true };
    if (st.type === "point") Object.assign(m, { v: st.v, rot: true });
    if (st.type === "line") { const sp = []; for (let a = 0; a <= st.splayMax + 1e-9; a += st.splayMax > 10 ? 1 : .5) sp.push(+a.toFixed(1)); Object.assign(m, { family: id, splays: sp, vRef: st.splayMax, vMin: 2 }); }
    P.custom.push(m); E.setCustom(P.custom); $("customNote").textContent = `Added ${m.brand} ${m.model}. Pick it from a group's model list.`; renderGroups(); saveSoon();
  } }, "Add to library"));
  f.append(el("p", { class: "note", id: "customNote" }, "Custom speakers are saved with this design."));
}

// ---------- ANALYZE pane
function setBand(b) {
  P.settings.band = b;
  for (const [id, v] of [["bandMid", "mid"], ["bandLF", "lf"], ["bandTime", "time"]]) $(id).setAttribute("aria-pressed", b === v);
  $("lfRow").hidden = b !== "lf"; $("winRow").hidden = b !== "time";
  $("bandNote").textContent = b === "mid" ? "Every non-sub speaker, 1–4 kHz, summed as energy." : b === "lf" ? (SRC.sub.length || P.groups.some(g => E.groupType(g) === "sub" && !g.mute) ? "Subs only, summed with phase (delay and polarity included). Dips show where sources cancel." : "Add a sub group to see the low-frequency map.")
    : "How far apart the arrivals are, among the groups within the window of the loudest one (delays and distance included). Under about 10 ms fuses into one sound; 30 ms and more can be heard as an echo.";
  update();
}
$("bandMid").onclick = () => setBand("mid"); $("bandLF").onclick = () => setBand("lf"); $("bandTime").onclick = () => setBand("time");
const bindRange = (id, key, f) => { const i = $(id); i.value = P.settings[key]; $(id + "V").textContent = f(i.value); i.oninput = () => { P.settings[key] = +i.value; $(id + "V").textContent = f(i.value); if (key === "lf" || key === "win") update(true); else saveSoon(); }; };
function bindSettings() {
  bindRange("lf", "lf", v => `${v} Hz`); bindRange("win", "win", v => `${v} dB`); bindRange("prec", "prec", v => `${v} ms`); bindRange("thr", "thr", v => `${v} dB low`);
  $("range").value = String(P.settings.range); $("optGoal").value = P.settings.goal;
  for (const k of ["showSeats", "showLines", "showWalls"]) $(k).checked = P.settings[k];
}
$("range").onchange = () => { P.settings.range = +$("range").value; update(); };
$("optGoal").onchange = () => { P.settings.goal = $("optGoal").value; saveSoon(); };
$("showSeats").onchange = () => { P.settings.showSeats = $("showSeats").checked; seats.visible = P.settings.showSeats; saveSoon(); };
$("showWalls").onchange = () => { P.settings.showWalls = $("showWalls").checked; walls.visible = P.settings.showWalls; saveSoon(); };
$("showLines").onchange = () => { P.settings.showLines = $("showLines").checked; update(); };
$("alignAll").onclick = () => {
  const list = P.groups.filter(g => !g.mute && ["fill", "delay", "outfill"].includes(g.role) && E.groupType(g) !== "sub");
  if (!list.length) { $("alignNote").textContent = "No fills, out-fills or delays to time. Set a group's role to one of those first."; return; }
  pushUndo("auto-time all");
  const order = ["outfill", "fill", "delay"], done = [];
  for (const role of order) for (const g of list.filter(x => x.role === role)) { const r = E.autoDelay(P.groups, geo, g, P.settings.prec); if (r.ok) { g.delay = r.ms; done.push(`${g.name} ${r.ms} ms`); } }
  $("alignNote").textContent = done.length ? `Timed: ${done.join(", ")}.` : "Nothing could be timed.";
  renderGroups(); update();
};
$("suggestBtn").onclick = () => {
  E.setCustom(P.custom);
  const r = E.suggestDelays(P.groups, geo, P.settings.thr), host = $("suggList"); host.innerHTML = "";
  weakSeats = r.weak; disposeGroup(marks);
  if (P.settings.band !== "mid") setBand("mid"); else update();
  if (!r.sugg.length) { host.append(el("p", { class: "note" }, r.weak.length ? `${r.weak.length} seats are low, but they are scattered rather than grouped, so there's no single spot for a speaker. They're shown in white.` : `No seats are more than ${P.settings.thr} dB under the median (${r.med ? r.med.toFixed(1) : "–"} dB).`)); return; }
  host.append(el("p", { class: "note" }, `Low seats are shown in white. Median is ${r.med.toFixed(1)} dB.`));
  r.sugg.forEach(sg => {
    const it = el("div", { class: "sitem" }, `<div><b>${sg.kind === "fill" ? "Fill" : "Delay"}${sg.mirror ? " pair" : ""}</b> for ${esc(sg.area)}. ${sg.kind === "fill" ? "Speaker at the stage front" : `${sg.n} × at ${Math.round(geo.lipC - sg.y)}' from the stage, ${ft(sg.z)} up`}, aimed ${sg.tilt}° down.</div>`);
    it.append(el("button", { onclick: () => applySuggestion(sg) }, "Add"));
    host.append(it);
    const ghost = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.8, 1.2), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }));
    ghost.position.copy(W3(sg.x, sg.y, sg.z + .9)); marks.add(ghost);
    if (sg.mirror) { const g2 = ghost.clone(); g2.position.copy(W3(2 * geo.cx - sg.x, sg.y, sg.z + .9)); marks.add(g2); }
  });
};
function pickModel(kind) {
  const main = P.groups.find(g => g.role === "main"); const brand = main ? E.model(E.groupType(main) === "line" ? main.boxes[0].m : main.model).brand : null;
  const pts = E.allModels().filter(m => m.type === "point" && (!brand || m.brand === brand)).sort((a, b) => a.maxSpl - b.maxSpl);
  if (!pts.length) return "gen-point-90x60";
  return kind === "fill" ? pts[0].id : (pts.find(m => m.maxSpl >= 125) || pts[pts.length - 1]).id;
}
function applySuggestion(sg) {
  pushUndo("add suggested speaker");
  const off = sg.x - geo.cx;
  const g = E.group({ name: sg.kind === "fill" ? "Fill" : "Delay", role: sg.kind === "fill" ? "fill" : "delay", color: nextColor(), model: pickModel(sg.kind), mount: sg.kind === "fill" ? "pole" : "flown",
    mirror: !!sg.mirror, off: sg.mirror ? Math.abs(off) : off, layout: sg.n > 1 ? "row" : "single", n: sg.n, spread: sg.spread, dist: geo.lipC - sg.y, z: sg.z, tilt: sg.tilt, pan: 0, gain: -20, open: true });
  P.groups.forEach(x => x.open = false); P.groups.push(g);
  // level: bring the cluster up to the median
  const seatsIdx = sg.idx, sub = seatsIdx.map(i => geo.seats[i]);
  const others = E.sources(P.groups.filter(x => x !== g), geo).mid, mine = () => E.sources([g], geo).mid;
  const eAvg = srcs => sub.reduce((a, s) => a + 10 ** (E.midAt(srcs, s.x, s.y, s.z + E.EAR) / 10), 0) / sub.length;
  const target = 10 ** (r_med() / 10), have = eAvg(others), need = target - have;
  if (need > 0) { const at = eAvg(mine()); g.gain = Math.max(-40, Math.min(6, Math.round((g.gain + 10 * Math.log10(need / at)) * 2) / 2)); }
  function r_med() { const sv = E.seatLevels(others, geo); return [...sv].sort((a, b) => a - b)[sv.length >> 1]; }
  const r = E.autoDelay(P.groups, geo, g, P.settings.prec); if (r.ok) g.delay = r.ms;
  weakSeats = null; disposeGroup(marks); $("suggList").innerHTML = "";
  document.querySelector('[data-tab="sys"]').click();
  renderGroups(); update();
}

// ---------- FILE pane
let saveT = null;
function saveSoon() { clearTimeout(saveT); saveT = setTimeout(() => LS.set("pa-designer.current", P), 500); }
$("projName").oninput = () => { P.name = $("projName").value; saveSoon(); };
function renderSaves() {
  const list = LS.get("pa-designer.saves") || [], host = $("saves"); host.innerHTML = "";
  if (!list.length) { host.append(el("p", { class: "note" }, "Nothing saved yet.")); return; }
  list.sort((a, b) => b.ts - a.ts).forEach(s => {
    const it = el("div", { class: "saveitem" }, `<div><b>${esc(s.name)}</b><div class="note">${new Date(s.ts).toLocaleString()}</div></div>`);
    const acts = el("div", { class: "acts" });
    acts.append(el("button", { onclick: () => { pushUndo("open saved design"); P = normalize(clone(s.data)); applyProject(); } }, "Open"));
    acts.append(el("button", { onclick: () => { LS.set("pa-designer.saves", (LS.get("pa-designer.saves") || []).filter(x => x.ts !== s.ts)); renderSaves(); } }, "Delete"));
    it.append(acts); host.append(it);
  });
}
$("saveBtn").onclick = () => {
  const list = (LS.get("pa-designer.saves") || []).filter(x => x.name !== P.name);
  list.push({ name: P.name, ts: Date.now(), data: P });
  $("fileNote").textContent = LS.set("pa-designer.saves", list) ? `Saved “${P.name}” in this browser.` : "This browser blocked saving. Export a file instead.";
  renderSaves();
};
$("newBtn").onclick = () => { pushUndo("new design"); P = newProject($("roomPreset").value); applyProject(); document.querySelector('[data-tab="room"]').click(); };
$("exportBtn").onclick = () => {
  const txt = JSON.stringify(P, null, 1), name = (P.name || "pa-design").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") + ".json";
  try { const a = el("a", { href: URL.createObjectURL(new Blob([txt], { type: "application/json" })), download: name }); document.body.append(a); a.click(); a.remove(); $("fileNote").textContent = `Exported ${name}.`; }
  catch (e) { $("fileNote").textContent = "This browser blocked the download."; }
};
$("importFile").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const d = JSON.parse(await f.text()); if (!d.room || !d.groups) throw new Error("not a PA Designer file"); pushUndo("import"); P = normalize(d); applyProject(); $("fileNote").textContent = `Imported “${P.name}”.`; }
  catch (err) { $("fileNote").textContent = `Couldn't read that file: ${err.message}.`; }
  e.target.value = "";
};
function refreshBom() {
  clearTimeout(refreshBom.t); refreshBom.t = setTimeout(() => {
    const rows = E.bom(P.groups.filter(g => !g.mute), geo);
    $("bom").innerHTML = rows.length ? `<table>${rows.map(r => `<tr><td class="n">${r.n}</td><td>${esc(r.m.model)}</td><td class="b">${esc(r.m.brand)}</td></tr>`).join("")}</table><p class="note">Speakers only; amps, rigging and cabling aren't counted. Muted groups are left out.</p>` : `<p class="note">No speakers.</p>`;
  }, 150);
}

// ---------- cameras
let CAMS = {};
function camsFor() {
  const W = geo.W, D = geo.D, cx = geo.cx, H = geo.ceil, m = Math.max(W, D);
  CAMS = { "3d": [[cx - W * .85, m * .75, -D * .05 + 8], [cx, 2, -D * .45]], top: [[cx, m * 1.35, -D / 2 - .1], [cx, 0, -D / 2]],
    foh: [[cx, 10.5 + geo.floorAt(cx, 6), -(geo.FOH ? geo.FOH[3] - 2 : 6)], [cx, 4, -geo.lipC - 3]], stage: [[cx, geo.stageH + 5.8, -(geo.lipC + 6)], [cx, 3, -D * .25]],
    side: [[-m * .75, H * .55, -D / 2], [cx, H * .4, -D / 2]] };
}
function setCam(k) {
  const [p, t] = CAMS[k], f = camera.aspect < 1.2 && k !== "foh" && k !== "stage" ? Math.min(2, (1.2 / camera.aspect) ** .7) : 1;
  camera.position.set(t[0] + (p[0] - t[0]) * f, t[1] + (p[1] - t[1]) * f, t[2] + (p[2] - t[2]) * f); controls.target.set(...t); controls.update();
}
document.querySelectorAll("[data-cam]").forEach(b => b.onclick = () => setCam(b.dataset.cam));

// ---------- hover readout
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), tip = $("tip");
canvas.addEventListener("pointermove", e => {
  const rc = canvas.getBoundingClientRect(); mouse.set((e.clientX - rc.left) / rc.width * 2 - 1, -(e.clientY - rc.top) / rc.height * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hit = ray.intersectObjects([seats, heat], false)[0];
  if (!hit || !seatVals) { tip.hidden = true; return; }
  let x = hit.point.x, y = -hit.point.z, z;
  if (hit.object === seats && hit.instanceId != null) { const s = geo.seats[hit.instanceId]; x = s.x; y = s.y; }
  if (!inAud(x, y)) { tip.hidden = true; return; }
  z = geo.floorAt(x, y) + E.EAR;
  const b = P.settings.band; let txt;
  if (b === "time") { const r = E.timeSpread(SRC.mid, x, y, z, P.settings.win); txt = `${r.ms.toFixed(1)} ms spread · ` + r.gs.slice(0, 3).map(q => `${q.g.name} ${q.t.toFixed(1)} ms ${q.L.toFixed(0)} dB`).join(" · "); }
  else if (b === "lf") txt = `${E.lfAt(SRC.sub, x, y, z, P.settings.lf).toFixed(1)} dB at ${P.settings.lf} Hz`;
  else { const gs = E.groupsAt(SRC.mid, x, y, z); txt = `${E.midAt(SRC.mid, x, y, z).toFixed(1)} dB · ` + gs.slice(0, 2).map(q => `${q.g.name} ${q.L.toFixed(1)}`).join(" · "); }
  txt += ` · ${Math.max(0, geo.lipY(x) - y).toFixed(0)}' from stage`;
  tip.hidden = false; tip.textContent = txt;
  const left = e.clientX - rc.left, flip = left > rc.width * .55;
  tip.style.left = left + "px"; tip.style.top = (e.clientY - rc.top) + "px"; tip.style.transform = flip ? "translate(calc(-100% - 12px), -50%)" : "translate(12px, -50%)";
});
canvas.addEventListener("pointerleave", () => { tip.hidden = true; });
function resize() { const r = canvas.parentElement.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(canvas.parentElement);

// ---------- optimizer
function score(sv) {
  const lean = P.settings.goal === "even_lean" ? 1.5 : 0, n = Math.max(2, geo.rows);
  const res = sv.map((v, i) => v + lean * geo.seats[i].row / (n - 1));
  const m = res.reduce((a, b) => a + b, 0) / res.length, sd = Math.sqrt(res.reduce((a, b) => a + (b - m) ** 2, 0) / res.length);
  const sorted = [...res].sort((a, b) => a - b);
  return sd + .25 * (sorted[Math.floor(sorted.length * .97)] - sorted[Math.floor(sorted.length * .03)]);
}
const tick = () => new Promise(r => setTimeout(r, 0));
async function optimize() {
  const btn = $("optBtn"), rack = document.querySelector(".rack");
  const groups = P.groups.filter(g => !g.mute && !g.lock && E.groupType(g) !== "sub");
  if (!groups.length || !geo.seats.length) { $("optNote").textContent = "Nothing to optimize: add speakers, or unlock a group."; return; }
  btn.disabled = true; rack.classList.add("busy");
  pushUndo("optimize");
  if (P.settings.band !== "mid") setBand("mid");
  const levels = () => E.seatLevels(E.sources(P.groups, geo).mid, geo);
  const sv0 = levels(), startAvg = E.energyAvg(sv0), before = score(sv0);
  let best = before, evals = 0;
  const tryIt = () => { evals++; return score(levels()); };
  const keep = async (apply, revert) => { apply(); const sc = tryIt(); if (sc < best - 1e-3) { best = sc; return true; } revert(); if (evals % 15 === 0) { btn.textContent = `Optimizing… ${evals}`; await tick(); } return false; };
  async function tuneNum(obj, key, steps, min, max) {
    for (const st of steps) { let improved = true; while (improved) { improved = false; for (const dir of [1, -1]) { const old = obj[key], nv = Math.min(max, Math.max(min, +(old + dir * st).toFixed(2))); if (nv === old) continue; if (await keep(() => obj[key] = nv, () => obj[key] = old)) { improved = true; break; } } } }
  }
  async function tryVals(obj, key, vals) { for (const v of vals) { const old = obj[key]; if (v === old) continue; await keep(() => obj[key] = v, () => obj[key] = old); } }
  const ref = groups.find(g => g.role === "main") || groups[0];
  for (let pass = 0; pass < 3; pass++) {
    for (const g of groups) {
      const t = E.groupType(g);
      if (t === "line") {
        const m0 = E.model(g.boxes[0].m), fam = E.allModels().filter(x => x.type === "line" && x.family === m0.family);
        for (const b of g.boxes) {
          const bm = E.model(b.m);
          if (bm.splays.length > 1) await tryVals(b, "splay", bm.splays.filter(s => Math.abs(s - b.splay) <= 3));
          if (fam.length > 1) await tryVals(b, "m", fam.map(x => x.id));
          if (bm.h.length > 1) await tryVals(b, "h", bm.h.map(o => o.id));
          await tryVals(b, "trim", [-6, -4, -3, -2, -1, 0]);
        }
        btn.textContent = `Optimizing… ${evals}`; await tick();
      } else {
        const m = E.model(g.model); if (m.h && m.h.length > 1) await tryVals(g, "hopt", m.h.map(o => o.id));
      }
      await tuneNum(g, "tilt", [4, 2, 1, .5], -30, 60);
      if (g.mount !== "lip" || geo.curved === false) await tuneNum(g, "pan", [4, 2, 1], -45, 45);
      if (g !== ref) await tuneNum(g, "gain", [4, 2, 1, .5], -40, 6);
    }
  }
  // hold the seat average
  const d = Math.round((startAvg - E.energyAvg(levels())) * 2) / 2;
  for (const g of P.groups) if (E.groupType(g) !== "sub" && !g.mute) g.gain = Math.max(-40, Math.min(6, g.gain + d));
  const sv = levels(), after = score(sv), sorted = [...sv].sort((a, b) => a - b), med = sorted[sorted.length >> 1];
  const pct = Math.round(sv.filter(v => Math.abs(v - med) <= 3).length / sv.length * 100);
  $("optNote").innerHTML = after < before - .05 ? `<b>Optimized</b> in ${evals} trials. Spread ${(sorted[sorted.length - 1] - sorted[0]).toFixed(1)} dB, ${pct}% of seats within ±3 dB. Fine-tune from here, or undo.` : `<b>No better layout found</b> in ${evals} trials. Try moving a group, changing a height or the box count, then optimize again.`;
  btn.textContent = "Optimize coverage"; btn.disabled = false; rack.classList.remove("busy");
  renderGroups(); update();
}
$("optBtn").onclick = optimize;

// ---------- start
function applyProject() {
  P = normalize(P); E.setCustom(P.custom);
  $("projName").value = P.name || "Untitled design";
  if (P.roomPreset) $("roomPreset").value = P.roomPreset;
  bindSettings(); renderRoomCtl(); renderCustomForm(); renderSaves();
  rebuildRoom(false); renderGroups(); setBand(P.settings.band);
}
resize();
P = (() => { const s = LS.get("pa-designer.current"); try { if (s && s.v === 2 && s.room && s.groups) return s; } catch (e) {} return newProject("rock-s14"); })();
applyProject(); resize();
(function loop() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop); })();
