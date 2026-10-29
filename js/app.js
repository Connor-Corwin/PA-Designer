/* PA Designer — 3D line-array coverage + SPL prediction. Room data comes from js/rooms/*.js (window.ROOM). */
const GEO = window.ROOM.geo;
const FT = 0.3048, EAR = 3.92, CEIL = 28.6, STAGE_H = 2, HANG_Y = 67.4, SUB_Y = 70.3;
const SPEC = {
  focus: { name: "A10i Focus", v: 10, lt: 140 - 10, h: 1.15 },
  wide:  { name: "A10i Wide",  v: 30, lt: 137 - 10, h: 1.14 },
  x4i:   { lt: 116 - 10, half: 55 },
  ks21:  { lt: 138 - 10 }
};
const FINS = { "70": [35, 35], "110": [55, 55], "90in": [55, 35], "90out": [35, 55] };   // [inside half, outside half]
const PRESETS = {
  rec:    [["focus", "70"], ["focus", "70"], ["focus", "110"], ["wide", "110"]],
  all110: [["focus", "110"], ["focus", "110"], ["focus", "110"], ["wide", "110"]],
  all70:  [["focus", "70"], ["focus", "70"], ["focus", "70"], ["wide", "70"]],
  asym:   [["focus", "90in"], ["focus", "90in"], ["focus", "90in"], ["wide", "110"]],
  ff2w2:  [["focus", "70"], ["focus", "70"], ["wide", "110"], ["wide", "110"]]
};
const S = { boxes: PRESETS.rec.map(([t, f]) => ({ t, f, g: 0 })), band: "mid" };
const $ = id => document.getElementById(id);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// ---------- geometry helpers
function inPoly(x, y, P) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
const inAudience = (x, y) => y < 70 && inPoly(x, y, GEO.AUD) && !inPoly(x, y, GEO.STAGE);
const lipY = x => GEO.C[1] - Math.sqrt(GEO.R * GEO.R - (x - GEO.C[0]) ** 2);
const deg = Math.PI / 180;

// ---------- sources
function sources() {
  const out = [], trim = +$("trim").value, site = +$("site").value, toe = +$("toe").value, off = +$("off").value, g0 = +$("gain").value;
  const n = S.boxes.length;
  for (const side of [-1, 1]) {
    const x = 32 + side * off, inward = -side;                         // inward = +x for the left hang
    const az = [inward * Math.sin(toe * deg), -Math.cos(toe * deg)];
    let ang = site, z = trim;
    const heights = S.boxes.map(b => SPEC[b.t].h);
    const tops = []; let acc = trim; for (let i = n - 1; i >= 0; i--) { tops[i] = acc + heights[i] / 2; acc += heights[i]; }
    S.boxes.forEach((b, i) => {
      const sp = SPEC[b.t]; const aim = ang + sp.v / 2; ang += sp.v;
      const [hin, hout] = FINS[b.f];
      out.push({ kind: b.t, i, side, x, y: HANG_Y, z: tops[i], az, down: aim, vHalf: sp.v / 2 * 1.3, hIn: hin, hOut: hout, inward, L: sp.lt + g0 + (+b.g || 0) });
    });
  }
  if ($("ffOn").checked) {
    const nf = +$("ffN").value, tilt = +$("ffTilt").value, gf = +$("ffGain").value;
    for (let k = 0; k < nf; k++) {
      const x = 18.5 + (45.5 - 18.5) * (nf === 1 ? .5 : k / (nf - 1)), y = lipY(x) - .3;
      const dx = x - GEO.C[0], dy = y - GEO.C[1], m = Math.hypot(dx, dy);
      out.push({ kind: "x4i", x, y, z: STAGE_H * .6, az: [dx / m, dy / m], down: -tilt, vHalf: 55, hIn: 55, hOut: 55, inward: 1, L: SPEC.x4i.lt + gf });
    }
  }
  return out;
}
function subSources() {
  if (!$("subOn").checked) return [];
  const n = +$("subN").value, off = +$("off").value, g = +$("subGain").value;
  return [-1, 1].map(side => ({ x: 32 + side * off, y: SUB_Y, z: +$("trim").value - 1, L: SPEC.ks21.lt + g + 20 * Math.log10(Math.max(1, n - 1)), n }));
}
// level (dB) of one directional source at a point
function srcLevel(s, px, py, pz) {
  const vx = px - s.x, vy = py - s.y, vz = pz - s.z;
  const r = Math.max(.5, Math.hypot(vx, vy, vz));
  const cd = Math.cos(s.down * deg), sd = Math.sin(s.down * deg);
  const fx = s.az[0] * cd, fy = s.az[1] * cd, fz = -sd;                // forward
  const rx = -s.az[1], ry = s.az[0];                                   // right (plan, horizontal)
  const ux = ry * fz, uy = -rx * fz, uz = rx * fy - ry * fx;           // up = right x forward
  const vf = vx * fx + vy * fy + vz * fz, vr = vx * rx + vy * ry, vu = vx * ux + vy * uy + vz * uz;
  let att;
  if (vf <= 0) att = -26;
  else {
    const th = Math.atan2(vr, vf) / deg, tv = Math.atan2(vu, vf) / deg;
    const insideIsRight = (rx * s.inward) > 0 ? 1 : -1;               // which side faces the room center
    const hh = (Math.sign(th) === insideIsRight) ? s.hIn : s.hOut;
    att = Math.max(-26, -6 * (th / hh) ** 2 - 6 * (tv / s.vHalf) ** 2);
  }
  return s.L + att - 20 * Math.log10(r * FT);
}
function midAt(srcs, x, y, z) { let p = 0; for (const s of srcs) p += 10 ** (srcLevel(s, x, y, z) / 10); return 10 * Math.log10(p || 1e-12); }
function lfAt(subs, x, y, z, f) {
  const k = 2 * Math.PI * f / 343; let re = 0, im = 0;
  for (const s of subs) {
    const vx = x - s.x, vy = y - s.y, vz = z - s.z, r = Math.max(.5, Math.hypot(vx, vy, vz)) * FT;
    const cosT = (-vy) / Math.max(.5, Math.hypot(vx, vy, vz));       // forward = toward the back wall (-y)
    const card = Math.max(.12, (1 + cosT) / 2);
    const a = 10 ** (s.L / 20) * card / r;
    re += a * Math.cos(-k * r); im += a * Math.sin(-k * r);
  }
  return 20 * Math.log10(Math.hypot(re, im) || 1e-9);
}

// ---------- three.js scene
const canvas = $("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
const scene = new THREE.Scene(); scene.background = new THREE.Color(css("--bg"));
const camera = new THREE.PerspectiveCamera(48, 1, .5, 800);
const controls = new THREE.OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = .08; controls.maxPolarAngle = Math.PI * .495;
const W = (x, y, z) => new THREE.Vector3(x, z, -y);
scene.add(new THREE.HemisphereLight(0xdfe6ef, 0x1a1c20, .85));
const dl = new THREE.DirectionalLight(0xffffff, .55); dl.position.set(20, 60, 30); scene.add(dl);

// floor + heat texture
const HM = { w: 128, h: 172 };
const heatCanvas = document.createElement("canvas"); heatCanvas.width = HM.w; heatCanvas.height = HM.h;
const hctx = heatCanvas.getContext("2d");
const heatTex = new THREE.CanvasTexture(heatCanvas); heatTex.magFilter = THREE.LinearFilter; heatTex.minFilter = THREE.LinearFilter;
const floorShape = new THREE.Shape(GEO.AUD.map(([x, y]) => new THREE.Vector2(x, y)));
const floorBase = new THREE.Mesh(new THREE.ShapeGeometry(floorShape), new THREE.MeshLambertMaterial({ color: 0x24282e }));
floorBase.rotation.x = -Math.PI / 2; scene.add(floorBase);
const heat = new THREE.Mesh(new THREE.PlaneGeometry(64, 86), new THREE.MeshBasicMaterial({ map: heatTex, transparent: true }));
heat.rotation.x = -Math.PI / 2; heat.position.set(32, .04, -43); scene.add(heat);

// stage
const stageShape = new THREE.Shape(GEO.STAGE.map(([x, y]) => new THREE.Vector2(x, y)));
const stage = new THREE.Mesh(new THREE.ExtrudeGeometry(stageShape, { depth: STAGE_H, bevelEnabled: false }), new THREE.MeshLambertMaterial({ color: 0x2e333a }));
stage.rotation.x = -Math.PI / 2; scene.add(stage);
// FOH booth (+14")
{ const [x0, y0, x1, y1] = GEO.FOH; const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 1.17, y1 - y0), new THREE.MeshLambertMaterial({ color: 0x343a42 })); b.position.copy(W((x0 + x1) / 2, (y0 + y1) / 2, .58)); scene.add(b);
  const d = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 - 1, 1, 2.2), new THREE.MeshLambertMaterial({ color: 0x4a515b })); d.position.copy(W((x0 + x1) / 2, y1 - 1.6, 2.6)); scene.add(d); }

// walls: inward-facing planes so the near walls drop away when you orbit outside
const walls = new THREE.Group(); scene.add(walls);
{
  const P = GEO.AUD, cx = 32, cy = 40;
  const mat = new THREE.MeshLambertMaterial({ color: 0x3a3f47, side: THREE.FrontSide, transparent: true, opacity: .55, depthWrite: false });
  for (let i = 0; i < P.length; i++) {
    const [x0, y0] = P[i], [x1, y1] = P[(i + 1) % P.length];
    const len = Math.hypot(x1 - x0, y1 - y0); if (len < .1) continue;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, CEIL), mat);
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2; m.position.copy(W(mx, my, CEIL / 2));
    let nx = -(y1 - y0) / len, ny = (x1 - x0) / len;                   // a normal; flip it toward the room
    if ((cx - mx) * nx + (cy - my) * ny < 0) { nx = -nx; ny = -ny; }
    m.lookAt(W(mx + nx, my + ny, CEIL / 2)); walls.add(m);
  }
  const edge = new THREE.LineBasicMaterial({ color: 0x59606b });
  for (const z of [0.02, CEIL]) walls.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(P.map(([x, y]) => W(x, y, z))), edge));
}

// seats
const seatGeo = new THREE.BoxGeometry(1.5, 2.6, 1.45); seatGeo.translate(0, 1.3, 0);
const seats = new THREE.InstancedMesh(seatGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), GEO.seats.length);
{ const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1);
  GEO.seats.forEach(([x, y, r], i) => { e.set(0, r + Math.PI / 2, 0); q.setFromEuler(e); m.compose(W(x, y, 0), q, sc); seats.setMatrixAt(i, m); seats.setColorAt(i, new THREE.Color(0x777777)); }); }
scene.add(seats);
const seatRows = (() => { const r = GEO.seats.map(([x, y]) => Math.hypot(x - GEO.C[0], y - GEO.C[1])); const uniq = [...new Set(r.map(v => Math.round(v / 2.83)))].sort((a, b) => a - b); return { r: r.map(v => uniq.indexOf(Math.round(v / 2.83))), n: uniq.length }; })();

// speakers + lines
const rig = new THREE.Group(); scene.add(rig);
const lines = new THREE.Group(); scene.add(lines);
function colorOf(kind) { return new THREE.Color(css(kind === "wide" ? "--wide" : kind === "x4i" ? "--fill" : kind === "sub" ? "--sub" : "--focus")); }
function buildRig(srcs, subs) {
  for (const g of [rig, lines]) { g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); g.clear(); }
  for (const s of srcs) {
    const isX = s.kind === "x4i";
    const geo = isX ? new THREE.BoxGeometry(.4, .4, .38) : new THREE.BoxGeometry(1.2, (SPEC[s.kind].h) * .95, 1.87);
    const mat = new THREE.MeshLambertMaterial({ color: isX ? colorOf("x4i") : 0x1b1d20, emissive: colorOf(s.kind), emissiveIntensity: isX ? .35 : .18 });
    const m = new THREE.Mesh(geo, mat); m.position.copy(W(s.x, s.y, s.z));
    const yaw = Math.atan2(s.az[1], s.az[0]);                          // world rotation about Y (plan y is -Z)
    m.rotation.order = "YZX"; m.rotation.y = yaw; m.rotation.z = -s.down * deg; rig.add(m);
    if (!isX) { const face = new THREE.Mesh(new THREE.PlaneGeometry(SPEC[s.kind].h * .8, 1.7), new THREE.MeshBasicMaterial({ color: colorOf(s.kind) })); face.position.set(.61, 0, 0); face.rotation.y = Math.PI / 2; face.rotation.z = Math.PI / 2; m.add(face); }
    if ($("showLines").checked && $("showLines") && S.band === "mid") {
      for (const sgn of [1, -1]) {                                       // the two -6 dB horizontal edges, drawn to ear height
        const inwardRight = ((-s.az[1]) * s.inward) > 0 ? 1 : -1;
        const half = (sgn === inwardRight) ? s.hIn : s.hOut;
        const a = sgn * half * deg, ca = Math.cos(a), sa = Math.sin(a);
        const rx = -s.az[1], ry = s.az[0];
        let dx = s.az[0] * ca + rx * sa, dy = s.az[1] * ca + ry * sa;
        const dz = -Math.tan(Math.max(1, s.down) * deg);
        let t = (EAR - s.z) / dz; if (!(t > 0) || t > 90) t = 90;
        if (isX) t = Math.min(t, 22);
        for (let u = 1; u < t; u += .5) { if (!inPoly(s.x + dx * u, s.y + dy * u, GEO.AUD)) { t = u; break; } }   // stop at the walls
        let ex = s.x + dx * t, ey = s.y + dy * t;
        const g = new THREE.BufferGeometry().setFromPoints([W(s.x, s.y, s.z), W(ex, ey, Math.max(EAR, s.z + dz * t))]);
        lines.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: colorOf(s.kind), transparent: true, opacity: isX ? .5 : .85 })));
      }
    }
  }
  for (const s of subs) {
    for (let i = 0; i < s.n; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.75, 2.7), new THREE.MeshLambertMaterial({ color: 0x1b1d20, emissive: colorOf("sub"), emissiveIntensity: .12 }));
      m.position.copy(W(s.x, s.y, s.z + 4.3 - i * 1.85)); rig.add(m);
      const rev = i === 1;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.5), new THREE.MeshBasicMaterial({ color: rev ? 0x5a6170 : colorOf("sub") }));
      face.position.copy(W(s.x, s.y + (rev ? 1.37 : -1.37), s.z + 4.3 - i * 1.85)); if (rev) face.rotation.y = Math.PI; rig.add(face);
    }
  }
  // rigging lines to the deck
  for (const x of [32 - +$("off").value, 32 + +$("off").value]) for (const y of [HANG_Y, ...(subs.length ? [SUB_Y] : [])]) {
    const g = new THREE.BufferGeometry().setFromPoints([W(x, y, CEIL), W(x, y, +$("trim").value + 5.2)]);
    rig.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x59606b })));
  }
}

// ---------- color map (turbo, perceptual-ish)
function turbo(t) {
  t = Math.min(1, Math.max(0, t));
  const r = 34.61 + t * (1172.33 - t * (10793.56 - t * (33300.12 - t * (38394.49 - t * 14825.05))));
  const g = 23.31 + t * (557.33 + t * (1225.33 - t * (3574.96 - t * (1073.77 + t * 707.56))));
  const b = 27.2 + t * (3211.1 - t * (15327.97 - t * (27814 - t * (22569.18 - t * 6838.66))));
  return [Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b))];
}
let LO = 80, HI = 98;
function drawLegend() {
  const c = $("legC"), g = c.getContext("2d");
  for (let i = 0; i < c.width; i++) { const [r, gg, b] = turbo(i / (c.width - 1)); g.fillStyle = `rgb(${r|0},${gg|0},${b|0})`; g.fillRect(i, 0, 1, c.height); }
  const span = HI - LO, step = span > 18 ? 6 : 3, ticks = [];
  for (let v = LO; v <= HI + .01; v += step) ticks.push(`<span>${Math.round(v)}</span>`);
  $("legTicks").innerHTML = ticks.join("");
  $("legT").textContent = S.band === "mid" ? "dB SPL, 1–4 kHz, seated ear height" : `dB SPL at ${$("lf").value} Hz, seated ear height`;
}

// ---------- compute + paint
let lastSrcs = [], lastSubs = [];
function levelAt(x, y) { return S.band === "mid" ? midAt(lastSrcs, x, y, EAR) : lfAt(lastSubs, x, y, EAR, +$("lf").value); }
function compute() {
  const srcs = sources(), subs = subSources(); lastSrcs = srcs; lastSubs = subs;
  buildRig(srcs, subs);
  const lfMode = S.band === "lf";
  if (lfMode && !subs.length) { hctx.clearRect(0, 0, HM.w, HM.h); heatTex.needsUpdate = true; setStats(null); paintSeats(null); return; }
  // seats first: they set the color range
  const sv = GEO.seats.map(([x, y]) => levelAt(x, y));
  const mx = Math.max(...sv); HI = Math.ceil(mx); LO = HI - +$("range").value;
  drawLegend(); paintSeats(sv); setStats(sv);
  const img = hctx.createImageData(HM.w, HM.h), d = img.data;
  for (let j = 0; j < HM.h; j++) {
    const y = 86 - (j + .5) * .5;
    for (let i = 0; i < HM.w; i++) {
      const x = (i + .5) * .5, o = (j * HM.w + i) * 4;
      if (!inAudience(x, y)) { d[o + 3] = 0; continue; }
      const L = levelAt(x, y), t = (L - LO) / (HI - LO);
      let [r, g, b] = turbo(t);
      const band = ((L % 3) + 3) % 3; if (band < .18) { r *= .55; g *= .55; b *= .55; }   // 3 dB contour
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 235;
    }
  }
  hctx.putImageData(img, 0, 0); heatTex.needsUpdate = true;
  $("amps").innerHTML = ampText();
}
function paintSeats(sv) {
  const c = new THREE.Color();
  GEO.seats.forEach((_, i) => { if (!sv) c.set(0x555555); else { const [r, g, b] = turbo((sv[i] - LO) / (HI - LO)); c.setRGB(r / 255, g / 255, b / 255); } seats.setColorAt(i, c); });
  seats.instanceColor.needsUpdate = true;
}
function setStats(sv) {
  if (!sv) { for (const id of ["sAvg", "sMM", "sSpread", "sPct", "sFront", "sBack"]) $(id).textContent = "–"; return; }
  const p = sv.map(v => 10 ** (v / 10)), avg = 10 * Math.log10(p.reduce((a, b) => a + b, 0) / p.length);
  const sorted = [...sv].sort((a, b) => a - b), med = sorted[sorted.length >> 1];
  const mn = sorted[0], mx = sorted[sorted.length - 1], within = sv.filter(v => Math.abs(v - med) <= 3).length / sv.length;
  const rowAvg = rows => { const v = sv.filter((_, i) => rows.includes(seatRows.r[i])); return v.length ? 10 * Math.log10(v.reduce((a, b) => a + 10 ** (b / 10), 0) / v.length) : NaN; };
  const front = rowAvg([0, 1, 2]), back = rowAvg([seatRows.n - 1, seatRows.n - 2, seatRows.n - 3]);
  $("sAvg").innerHTML = `${avg.toFixed(1)}<small> dB</small>`;
  $("sMM").innerHTML = `${mn.toFixed(0)}–${mx.toFixed(0)}`;
  const spread = mx - mn; $("sSpread").innerHTML = `<span style="color:var(${spread <= 6 ? "--good" : spread <= 10 ? "--warn" : "--bad"})">${spread.toFixed(1)}</span><small> dB</small>`;
  $("sPct").innerHTML = `<span style="color:var(${within >= .9 ? "--good" : within >= .75 ? "--warn" : "--bad"})">${Math.round(within * 100)}%</span>`;
  $("sFront").innerHTML = `${front.toFixed(1)}<small> dB</small>`; $("sBack").innerHTML = `${back.toFixed(1)}<small> dB</small>`;
}
function ampText() {
  const a10 = S.boxes.length * 2, ks = $("subOn").checked ? +$("subN").value * 2 : 0, ff = $("ffOn").checked ? +$("ffN").value : 0;
  const ch = a10 + ks, la4x = Math.ceil(ch / 4);
  return `<b>${a10} A10i + ${ks} KS21i</b> = ${ch} channels at one box per channel: ${la4x} × LA4X (${la4x * 4 - ch} spare). <b>${ff} X4i</b> on the LA2Xi.`;
}

// ---------- UI
function renderBoxes() {
  const host = $("boxes"); host.innerHTML = "";
  S.boxes.forEach((b, i) => {
    const el = document.createElement("div"); el.className = "box";
    el.innerHTML = `<span class="n">${i + 1}</span><span class="chip" style="background:var(${b.t === "wide" ? "--wide" : "--focus"})"></span>
      <div class="boxrow"><select id="bt${i}" aria-label="Box ${i + 1} type"><option value="focus">Focus 10°</option><option value="wide">Wide 30°</option></select>
      <select id="bf${i}" aria-label="Box ${i + 1} horizontal"><option value="70">70°</option><option value="110">110°</option><option value="90in">90° in</option><option value="90out">90° out</option></select></div>
      <input id="bg${i}" type="number" min="-12" max="6" step="0.5" value="${b.g}" aria-label="Box ${i + 1} level trim, dB" title="Level trim, dB">`;
    host.appendChild(el);
    el.querySelector(`#bt${i}`).value = b.t; el.querySelector(`#bf${i}`).value = b.f;
    el.querySelector(`#bt${i}`).onchange = e => { b.t = e.target.value; custom(); renderBoxes(); update(); };
    el.querySelector(`#bf${i}`).onchange = e => { b.f = e.target.value; custom(); update(); };
    el.querySelector(`#bg${i}`).oninput = e => { b.g = +e.target.value || 0; custom(); update(); };
  });
  $("rmBox").disabled = S.boxes.length <= 2; $("addBox").disabled = S.boxes.length >= 8;
}
function custom() { $("preset").value = "custom"; }
const fmt = { trim: v => `${(+v).toFixed(1)}'`, site: v => `${(+v).toFixed(1)}°`, toe: v => `${(+v).toFixed(1)}°`, off: v => `${(+v).toFixed(1)}'`, gain: v => `${v} dB`,
  ffGain: v => `${v} dB`, ffTilt: v => `${v}°`, subGain: v => `${v} dB`, lf: v => `${v} Hz` };
function refreshOutputs() { for (const id of Object.keys(fmt)) $(id + "V").textContent = fmt[id]($(id).value); }
for (const id of Object.keys(fmt)) { const el = $(id); el.addEventListener("input", () => { $(id + "V").textContent = fmt[id](el.value); update(); }); }
refreshOutputs();
for (const id of ["ffOn", "ffN", "subOn", "subN", "showLines", "range"]) $(id).addEventListener("change", update);
$("showSeats").addEventListener("change", () => { seats.visible = $("showSeats").checked; });
$("showWalls").addEventListener("change", () => { walls.visible = $("showWalls").checked; });
$("preset").addEventListener("change", e => { const p = PRESETS[e.target.value]; if (!p) return; S.boxes = p.map(([t, f]) => ({ t, f, g: 0 })); renderBoxes(); update(); });
$("addBox").onclick = () => { S.boxes.push({ t: "wide", f: "110", g: 0 }); custom(); renderBoxes(); update(); };
$("rmBox").onclick = () => { S.boxes.pop(); custom(); renderBoxes(); update(); };
function setBand(b) {
  S.band = b; $("bandMid").setAttribute("aria-pressed", b === "mid"); $("bandLF").setAttribute("aria-pressed", b === "lf");
  $("lfRow").hidden = b !== "lf";
  $("bandNote").textContent = b === "mid" ? "A10i hangs and X4i fills, 1–4 kHz, summed as energy." : ($("subOn").checked ? "KS21i only, summed with phase at the chosen frequency. The dips show where left and right cancel." : "Turn the subs on to see the low-frequency map.");
  update();
}
$("bandMid").onclick = () => setBand("mid"); $("bandLF").onclick = () => setBand("lf");
let pending = false;
function update() { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; compute(); }); }

// cameras
const CAMS = { "3d": [[-22, 62, 10], [32, 2, -38]], top: [[32, 118, -40.1], [32, 0, -40]], foh: [[32, 10.5, -5], [32, 4, -66]], stage: [[32, 7.8, -72], [32, 3, -20]], side: [[-60, 14, -42], [32, 10, -42]] };
function setCam(k) { const [p, t] = CAMS[k]; camera.position.set(...p); controls.target.set(...t); controls.update(); }
document.querySelectorAll("[data-cam]").forEach(b => b.onclick = () => setCam(b.dataset.cam));

// hover readout
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), tip = $("tip");
canvas.addEventListener("pointermove", e => {
  const rc = canvas.getBoundingClientRect(); mouse.set((e.clientX - rc.left) / rc.width * 2 - 1, -(e.clientY - rc.top) / rc.height * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hit = ray.intersectObjects([seats, heat], false)[0];
  if (!hit) { tip.hidden = true; return; }
  let x = hit.point.x, y = -hit.point.z;
  if (hit.object === seats && hit.instanceId != null) [x, y] = GEO.seats[hit.instanceId];
  if (!inAudience(x, y) || (S.band === "lf" && !lastSubs.length)) { tip.hidden = true; return; }
  const L = levelAt(x, y), dLip = lipY(Math.min(47, Math.max(17, x))) - y;
  tip.hidden = false; tip.style.left = (e.clientX - rc.left) + "px"; tip.style.top = (e.clientY - rc.top) + "px";
  tip.textContent = `${L.toFixed(1)} dB  ·  ${Math.max(0, dLip).toFixed(0)}' from stage edge`;
});
canvas.addEventListener("pointerleave", () => { tip.hidden = true; });

function resize() { const r = canvas.parentElement.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(canvas.parentElement);
// ---------- snapshot / reset / optimize
const CTRL = [...document.querySelectorAll(".rack input, .rack select")].map(e => e.id).filter(id => id && !/^b[tfg]\d/.test(id) && id !== "optGoal");
function snap() { const v = {}; for (const id of CTRL) { const e = $(id); v[id] = e.type === "checkbox" ? e.checked : e.value; } return { v, boxes: S.boxes.map(b => ({ ...b })), band: S.band }; }
function restore(sn) {
  for (const id of CTRL) { const e = $(id); if (e.type === "checkbox") e.checked = sn.v[id]; else e.value = sn.v[id]; }
  S.boxes = sn.boxes.map(b => ({ ...b })); seats.visible = $("showSeats").checked; walls.visible = $("showWalls").checked;
  refreshOutputs(); renderBoxes(); setBand(sn.band);
}
let DEFAULTS = null, beforeOpt = null;
$("resetBtn").onclick = () => { restore(DEFAULTS); setCam("3d"); $("undoBtn").hidden = true; beforeOpt = null; $("optNote").textContent = "Everything is back to the starting layout."; };
$("undoBtn").onclick = () => { if (beforeOpt) restore(beforeOpt); $("undoBtn").hidden = true; beforeOpt = null; $("optNote").textContent = "Restored the layout from before Optimize."; };

function seatLevels() { const srcs = sources(); return GEO.seats.map(([x, y]) => midAt(srcs, x, y, EAR)); }
function rowAvgOf(sv, rows) { let p = 0, n = 0; sv.forEach((v, i) => { if (rows.includes(seatRows.r[i])) { p += 10 ** (v / 10); n++; } }); return 10 * Math.log10(p / n); }
const FRONT = [0, 1, 2], BACK = () => [seatRows.n - 1, seatRows.n - 2, seatRows.n - 3];
function score(sv) {
  const lean = $("optGoal").value === "even_lean" ? 1.5 : 0;
  const rd = seatRows.r, n = seatRows.n;
  const target = sv.map((_, i) => -lean * rd[i] / (n - 1));           // desired shape (relative), 0 at the front row
  const res = sv.map((v, i) => v - target[i]);
  const m = res.reduce((a, b) => a + b, 0) / res.length;
  const sd = Math.sqrt(res.reduce((a, b) => a + (b - m) ** 2, 0) / res.length);
  const sorted = [...res].sort((a, b) => a - b);
  const p5 = sorted[Math.floor(sorted.length * .03)], p95 = sorted[Math.floor(sorted.length * .97)];
  return sd + .25 * (p95 - p5);
}
const tick = () => new Promise(r => setTimeout(r, 0));
async function optimize() {
  const btn = $("optBtn"); btn.disabled = true; $("resetBtn").disabled = true; document.querySelector(".rack").classList.add("busy");
  setBand("mid");
  beforeOpt = snap();
  const startAvg = (() => { const sv = seatLevels(); return 10 * Math.log10(sv.reduce((a, b) => a + 10 ** (b / 10), 0) / sv.length); })();
  const before = score(seatLevels());
  let best = before, evals = 0;
  const tryIt = () => { evals++; return score(seatLevels()); };
  const n = S.boxes.length;
  // candidate layouts: k Focus boxes on top, the rest Wide
  const setNum = (id, v) => { const e = $(id); v = Math.min(+e.max, Math.max(+e.min, v)); e.value = String(v); };
  async function tune(id, steps) {
    for (const st of steps) {
      let improved = true;
      while (improved) {
        improved = false;
        for (const dir of [1, -1]) {
          const e = $(id), old = +e.value; const nv = Math.min(+e.max, Math.max(+e.min, old + dir * st)); if (nv === old) continue;
          e.value = String(nv); const sc = tryIt();
          if (sc < best - 1e-3) { best = sc; improved = true; break; } else e.value = String(old);
        }
        if (evals % 12 === 0) { btn.textContent = `Optimizing… ${evals}`; await tick(); }
      }
    }
  }
  async function tuneBoxes() {
    // Focus / Wide split (Focus always above Wide)
    for (let k = 0; k <= n; k++) {
      const old = S.boxes.map(b => b.t);
      S.boxes.forEach((b, i) => b.t = i < k ? "focus" : "wide");
      const sc = tryIt(); if (sc < best - 1e-3) best = sc; else S.boxes.forEach((b, i) => b.t = old[i]);
    }
    for (let i = 0; i < n; i++) {
      for (const f of ["70", "110", "90in", "90out"]) {
        const old = S.boxes[i].f; if (f === old) continue; S.boxes[i].f = f;
        const sc = tryIt(); if (sc < best - 1e-3) best = sc; else S.boxes[i].f = old;
      }
      for (const g of [-6, -4, -3, -2, -1, 0]) {
        const old = S.boxes[i].g; if (g === old) continue; S.boxes[i].g = g;
        const sc = tryIt(); if (sc < best - 1e-3) best = sc; else S.boxes[i].g = old;
      }
      btn.textContent = `Optimizing… ${evals}`; await tick();
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    await tuneBoxes();
    await tune("site", [4, 2, 1, .5]);
    await tune("toe", [4, 2, 1, .5]);
    if ($("ffOn").checked) await tune("ffGain", [4, 2, 1]), await tune("ffTilt", [4, 2, 1]);
  }
  // keep the seat average where it started
  const sv = seatLevels(); const avg = 10 * Math.log10(sv.reduce((a, b) => a + 10 ** (b / 10), 0) / sv.length);
  const d = Math.round((startAvg - avg) * 2) / 2;
  setNum("gain", +$("gain").value + d); setNum("ffGain", +$("ffGain").value + d);
  refreshOutputs(); renderBoxes(); custom(); update();
  const after = score(seatLevels());
  const sv2 = seatLevels(); const sorted = [...sv2].sort((a, b) => a - b); const med = sorted[sorted.length >> 1];
  const pct = Math.round(sv2.filter(v => Math.abs(v - med) <= 3).length / sv2.length * 100);
  $("optNote").innerHTML = after < before - .05
    ? `<b>Optimized</b> in ${evals} trials. Spread ${(sorted[sorted.length - 1] - sorted[0]).toFixed(1)} dB, ${pct}% of seats within ±3 dB. Fine-tune from here, or undo.`
    : `<b>No better layout found</b> within these limits (${evals} trials). Try moving the hangs or changing the hang height, then optimize again.`;
  $("undoBtn").hidden = false;
  btn.textContent = "Optimize coverage"; btn.disabled = false; $("resetBtn").disabled = false; document.querySelector(".rack").classList.remove("busy");
}
$("optBtn").onclick = optimize;

$("roomDesc").textContent = window.ROOM.description;
renderBoxes(); setBand("mid"); setCam("3d"); resize();
DEFAULTS = snap();
(function loop() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop); })();
