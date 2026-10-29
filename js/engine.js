/* Acoustic engine: turns speaker groups into sources and predicts level and arrival time.
 * A group is one speaker design element (a hang, a pair of poles, a row of front fills, a delay ring, a sub array):
 *   { id, name, role, color, model, boxes[], hopt, rot, mount, mirror, layout, n, spread, off, dist, z, pan, tilt, gain, delay, polarity, mute, lock, subN, subMode }
 * Positions: off = feet from the room center line (mirrored groups get a twin at −off),
 *   dist = feet from the stage front toward the back (negative = over the stage), z = height of the bottom of the speaker above the main floor.
 */
(function () {
  const FT = 0.3048, C_FTS = 1125, EAR = 3.92, deg = Math.PI / 180;
  const ROLES = { main: "Main", outfill: "Out-fill", fill: "Front fill", delay: "Delay", sub: "Sub", other: "Other" };
  const MOUNTS = { flown: "Flown", pole: "On a pole / stand", stack: "Ground stack", wall: "Wall / bracket", lip: "In the stage front" };
  const COLORS = ["#f0a63a", "#3cc4c0", "#c78bf2", "#6fd08c", "#f27aa6", "#6aa8f2", "#e6d35a", "#f2705e"];

  let custom = [];
  const setCustom = list => { custom = list || []; };
  const allModels = () => window.SPEAKERS.concat(custom);
  const model = id => allModels().find(m => m.id === id) || window.SPEAKERS[0];
  const mm = v => v / 304.8;
  const hOpt = (m, id) => (m.h && (m.h.find(o => o.id === id) || m.h[0])) || { in: 45, out: 45 };
  const groupType = g => (g.boxes && g.boxes.length ? model(g.boxes[0].m) : model(g.model)).type;

  // ---------- positions of every unit in a group
  function unitPositions(g, geo) {
    let ps = [];
    if (g.layout === "row" && g.n > 1) for (let i = 0; i < g.n; i++) ps.push(g.off + g.spread * (i / (g.n - 1) - .5));
    else ps.push(g.off);
    if (g.mirror) { const tw = ps.map(p => -p).filter(p => !ps.some(q => Math.abs(q - p) < .05)); ps = ps.concat(tw); }
    return ps.map(p => {
      const x = geo.cx + p, s = p > .01 ? 1 : p < -.01 ? -1 : 1;
      const y = (g.mount === "lip" ? geo.lipY(x) - .3 : geo.lipC) - (g.mount === "lip" ? 0 : g.dist);
      let base = [0, -1];
      if (g.mount === "lip" && geo.C && isFinite(geo.R)) { const dx = x - geo.C[0], dy = y - geo.C[1], m = Math.hypot(dx, dy) || 1; base = [dx / m, dy / m]; }
      const a = -s * g.pan * deg, ca = Math.cos(a), sa = Math.sin(a);
      const az = [base[0] * ca - base[1] * sa, base[0] * sa + base[1] * ca];
      return { x, y, s, az, inward: -s };
    });
  }

  // ---------- sources
  function sources(groups, geo) {
    const mid = [], sub = [];
    groups.forEach((g, gi) => {
      if (g.mute) return;
      const pol = g.polarity < 0 ? -1 : 1;
      for (const u of unitPositions(g, geo)) {
        const t = groupType(g);
        if (t === "line") {
          const boxes = g.boxes.map(b => ({ b, m: model(b.m) }));
          const hs = boxes.map(({ m }) => mm(m.dims[0]));
          const z0 = g.mount === "lip" ? geo.stageH * .6 : g.z;
          let acc = z0; const centers = []; for (let i = boxes.length - 1; i >= 0; i--) { centers[i] = acc + hs[i] / 2; acc += hs[i]; }
          let ang = g.tilt;
          boxes.forEach(({ b, m }, i) => {
            const sp = m.splays.length === 1 ? m.splays[0] : b.splay;
            const open = Math.max(sp, m.vMin), aim = ang + open / 2; ang += sp;
            const ho = hOpt(m, b.h);
            mid.push({ g, gi, m, i, x: u.x, y: u.y, z: centers[i], az: u.az, inward: u.inward, down: aim, vHalf: open / 2 * 1.3, hIn: ho.in, hOut: ho.out,
              L: m.maxSpl - 10 + g.gain + (+b.trim || 0) + 10 * Math.log10(m.vRef / open), dly: g.delay, pol, box: [hs[i], mm(m.dims[1]), mm(m.dims[2])], tiltDraw: aim });
          });
        } else if (t === "point") {
          const m = model(g.model), ho = hOpt(m, g.hopt);
          const rot = g.rot && m.rot;
          const hIn = rot ? m.v / 2 : ho.in, hOut = rot ? m.v / 2 : ho.out, vHalf = rot ? (ho.in + ho.out) / 2 : m.v / 2;
          const dims = rot ? [mm(m.dims[1]), mm(m.dims[0]), mm(m.dims[2])] : [mm(m.dims[0]), mm(m.dims[1]), mm(m.dims[2])];
          const zc = g.mount === "lip" ? geo.stageH * .6 : g.z + dims[0] / 2;
          mid.push({ g, gi, m, i: 0, x: u.x, y: u.y, z: zc, az: u.az, inward: u.inward, down: g.tilt, vHalf, hIn, hOut, L: m.maxSpl - 10 + g.gain, dly: g.delay, pol, box: dims, tiltDraw: g.tilt });
        } else {
          const m = model(g.model), n = Math.max(1, g.subN | 0), card = g.subMode === "cardioid" && n >= 2;
          const bh = mm(m.dims[0]);
          sub.push({ g, gi, m, x: u.x, y: u.y, z: g.z + n * bh / 2, az: u.az, n, card, L: m.maxSpl - 10 + g.gain + 20 * Math.log10(Math.max(1, card ? n - 1 : n)), dly: g.delay, pol,
            box: [bh, mm(m.dims[1]), mm(m.dims[2])] });
        }
      }
    });
    return { mid, sub };
  }

  // level (dB) of one directional mid/high source at a point
  function srcLevel(s, px, py, pz) {
    const vx = px - s.x, vy = py - s.y, vz = pz - s.z;
    const r = Math.max(.5, Math.hypot(vx, vy, vz));
    const cd = Math.cos(s.down * deg), sd = Math.sin(s.down * deg);
    const fx = s.az[0] * cd, fy = s.az[1] * cd, fz = -sd;
    const rx = -s.az[1], ry = s.az[0];
    const ux = ry * fz, uy = -rx * fz, uz = rx * fy - ry * fx;
    const vf = vx * fx + vy * fy + vz * fz, vr = vx * rx + vy * ry, vu = vx * ux + vy * uy + vz * uz;
    let att;
    if (vf <= 0) att = -26;
    else {
      const th = Math.atan2(vr, vf) / deg, tv = Math.atan2(vu, vf) / deg;
      const insideIsRight = (rx * s.inward) > 0 ? 1 : -1;
      const hh = (Math.sign(th) === insideIsRight) ? s.hIn : s.hOut;
      att = Math.max(-26, -6 * (th / hh) ** 2 - 6 * (tv / s.vHalf) ** 2);
    }
    return s.L + att - 20 * Math.log10(r * FT);
  }
  const arrival = (s, px, py, pz) => Math.hypot(px - s.x, py - s.y, pz - s.z) / C_FTS * 1000 + (s.dly || 0);
  function midAt(srcs, x, y, z) { let p = 0; for (const s of srcs) p += 10 ** (srcLevel(s, x, y, z) / 10); return 10 * Math.log10(p || 1e-12); }
  function lfAt(subs, x, y, z, f) {
    const k = 2 * Math.PI * f / 343; let re = 0, im = 0;
    for (const s of subs) {
      const vx = x - s.x, vy = y - s.y, vz = z - s.z, d = Math.max(.5, Math.hypot(vx, vy, vz)), r = d * FT;
      const cosT = (vx * s.az[0] + vy * s.az[1]) / d;
      const dirf = s.card ? Math.max(.12, (1 + cosT) / 2) : 1;
      const a = s.pol * 10 ** (s.L / 20) * dirf / r, ph = -k * r - 2 * Math.PI * f * (s.dly || 0) / 1000;
      re += a * Math.cos(ph); im += a * Math.sin(ph);
    }
    return 20 * Math.log10(Math.hypot(re, im) || 1e-9);
  }
  // per group: summed level and the arrival time of its loudest unit
  function groupsAt(srcs, x, y, z) {
    const by = new Map();
    for (const s of srcs) {
      const L = srcLevel(s, x, y, z); let e = by.get(s.g);
      if (!e) { e = { g: s.g, p: 0, best: -1e9, t: 0 }; by.set(s.g, e); }
      e.p += 10 ** (L / 10); if (L > e.best) { e.best = L; e.t = arrival(s, x, y, z); }
    }
    return [...by.values()].map(e => ({ g: e.g, L: 10 * Math.log10(e.p), t: e.t })).sort((a, b) => b.L - a.L);
  }
  // arrival spread (ms) among groups within `win` dB of the loudest one
  function timeSpread(srcs, x, y, z, win = 10) {
    const gs = groupsAt(srcs, x, y, z); if (gs.length < 2) return { ms: 0, gs };
    const top = gs[0].L, near = gs.filter(e => e.L >= top - win);
    const ts = near.map(e => e.t);
    return { ms: Math.max(...ts) - Math.min(...ts), gs: near, first: near.reduce((a, b) => a.t <= b.t ? a : b) };
  }

  // ---------- stats over the seats
  const ear = (geo, s) => s.z + EAR;
  function seatLevels(srcs, geo) { return geo.seats.map(s => midAt(srcs, s.x, s.y, ear(geo, s))); }
  function energyAvg(v) { return 10 * Math.log10(v.reduce((a, b) => a + 10 ** (b / 10), 0) / v.length); }

  // ---------- auto delay: align a group to the loudest other group across the seats it covers, plus a precedence offset
  function autoDelay(groups, geo, g, offsetMs) {
    const { mid, sub } = sources(groups, geo);
    if (groupType(g) === "sub") return { ok: false, msg: "Subs are timed from the Subs map." };
    const mine = mid.filter(s => s.g === g);
    let others = mid.filter(s => s.g !== g && (s.g.role === "main" || s.g.role === "outfill"));
    if (!others.length) others = mid.filter(s => s.g !== g);
    if (!mine.length || !others.length) return { ok: false, msg: "Needs another group to align to." };
    const rows = geo.seats.map(s => { const z = ear(geo, s); return { s, a: midAt(mine, s.x, s.y, z), b: midAt(others, s.x, s.y, z) }; });
    let target = rows.filter(r => r.a >= r.b - 3);
    if (target.length < 5) target = [...rows].sort((p, q) => (q.a - q.b) - (p.a - p.b)).slice(0, 12);
    const diffs = target.map(({ s }) => {
      const z = ear(geo, s);
      const ref = others.reduce((p, q) => srcLevel(q, s.x, s.y, z) > srcLevel(p, s.x, s.y, z) ? q : p);
      const me = mine.reduce((p, q) => srcLevel(q, s.x, s.y, z) > srcLevel(p, s.x, s.y, z) ? q : p);
      return arrival(ref, s.x, s.y, z) - (arrival(me, s.x, s.y, z) - (me.dly || 0));
    }).sort((a, b) => a - b);
    const med = diffs[diffs.length >> 1];
    const ms = Math.max(0, Math.round((med + offsetMs) * 10) / 10);
    return { ok: true, ms, seats: target.length, msg: med + offsetMs < 0 ? "This speaker is already later than the mains there, so it is set to 0 ms. Move it back or delay the mains." : null };
  }

  // ---------- delay suggestions: clusters of seats more than `thr` dB under the median, with a speaker position for each
  function suggestDelays(groups, geo, thr) {
    const { mid } = sources(groups, geo); if (!mid.length) return { weak: [], sugg: [] };
    const sv = seatLevels(mid, geo), med = [...sv].sort((a, b) => a - b)[sv.length >> 1];
    const weak = geo.seats.map((s, i) => ({ s, i, L: sv[i] })).filter(o => o.L < med - thr);
    const left = new Set(weak.map(w => w.i)), byI = new Map(weak.map(w => [w.i, w])), clusters = [];
    for (const w of weak) {
      if (!left.has(w.i)) continue;
      const cl = [], q = [w]; left.delete(w.i);
      while (q.length) { const a = q.pop(); cl.push(a); for (const j of [...left]) { const b = byI.get(j); if (Math.hypot(a.s.x - b.s.x, a.s.y - b.s.y) < 4.5) { left.delete(j); q.push(b); } } }
      if (cl.length >= 8) clusters.push(cl);
    }
    const sugg = clusters.map(cl => {
      const xs = cl.map(c => c.s.x), ys = cl.map(c => c.s.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), yFront = Math.max(...ys), yBack = Math.min(...ys);
      const cxl = xs.reduce((a, b) => a + b, 0) / xs.length, cyl = (yFront + yBack) / 2;
      const width = x1 - x0, n = width > 44 ? 3 : width > 24 ? 2 : 1;
      const nearStage = yFront > geo.lipC - 22;
      const kind = nearStage ? "fill" : "delay";
      const y = nearStage ? geo.lipC - 1.5 : Math.min(geo.lipC - 4, yFront + 6);
      const z = nearStage ? 5.5 : Math.max(9, Math.min(geo.ceil - 2.5, 14));
      const tilt = Math.round(Math.atan2(z - EAR, Math.max(4, y - cyl)) / deg);
      const pan = 0;
      const deficit = med - energyAvg(cl.map(c => c.L));
      return { kind, idx: cl.map(c => c.i), seats: cl.length, deficit, x: cxl, y, z, n: nearStage ? 1 : n, spread: !nearStage && n > 1 ? width * (n - 1) / n : 0, tilt, pan, depth: yFront - yBack,
        area: `${cl.length} seats, ${Math.round(yFront - yBack)}' deep × ${Math.round(width)}' wide, ${deficit.toFixed(1)} dB under the median` };
    }).sort((a, b) => b.seats - a.seats);
    // fold left / right twins into one mirrored suggestion
    const out = [];
    for (const a of sugg) {
      const tw = out.find(b => !b.mirror && b.kind === a.kind && Math.abs((a.x - geo.cx) + (b.x - geo.cx)) < 5 && Math.abs(a.x - geo.cx) > 3 && Math.abs(a.y - b.y) < 6);
      if (tw) { tw.mirror = true; tw.idx = tw.idx.concat(a.idx); tw.area += ", on each side"; } else out.push(a);
    }
    return { weak: weak.map(w => w.i), sugg: out, med };
  }

  // ---------- templates fitted to a room
  let nid = 1;
  const newId = () => "g" + (Date.now().toString(36)) + (nid++);
  function group(over) {
    return Object.assign({ id: newId(), name: "Group", role: "other", color: COLORS[0], model: "gen-point-90x60", boxes: [], hopt: null, rot: false, mount: "flown", mirror: false, layout: "single", n: 1, spread: 0,
      off: 0, dist: 0, z: 12, pan: 0, tilt: 0, gain: -12, delay: 0, polarity: 1, mute: false, lock: false, subN: 2, subMode: "cardioid", open: false }, over);
  }
  function lineGroup(over, mid, boxes) { return group(Object.assign({ type: "line", model: mid, boxes }, over)); }
  function makeTemplate(id, geo) {
    const hw = Math.max(6, Math.min(geo.stageW / 2, geo.W / 2 - 4));
    const z = Math.max(12, Math.min(geo.ceil - 5, 26));
    const deep = geo.lipC;                                             // stage front to back wall
    if (id === "rock") return [
      lineGroup({ name: "Mains", role: "main", color: COLORS[0], mirror: true, off: 18.75, dist: -3.4, z: 18.5, pan: 10, tilt: 15, gain: -14, open: true }, "lac-a10i-focus",
        [["lac-a10i-focus", "70"], ["lac-a10i-focus", "70"], ["lac-a10i-focus", "110"], ["lac-a10i-wide", "110"]].map(([m, h]) => ({ m, h, splay: 0, trim: 0 }))),
      group({ name: "Front fills", role: "fill", color: COLORS[2], model: "lac-x4i", mount: "lip", layout: "row", n: 6, spread: 27, off: 0, tilt: -8, gain: -10 }),
      group({ name: "Subs", role: "sub", color: COLORS[5], model: "lac-ks21", mount: "flown", mirror: true, off: 18.75, dist: -6.3, z: 14.9, subN: 3, subMode: "cardioid", gain: -20 })
    ];
    if (id === "lr-line") {
      const nBox = Math.max(4, Math.min(10, Math.round(deep / 11)));
      const splays = Array.from({ length: nBox }, (_, i) => [1, 2, 3, 4, 5, 7.5, 10, 10, 10, 10][Math.round(i * 6 / Math.max(1, nBox - 1))]);
      return [
        lineGroup({ name: "Mains", role: "main", color: COLORS[0], mirror: true, off: hw + 1, dist: 1, z, pan: 8, tilt: 2, gain: -14, open: true }, "lac-kara2",
          splays.map(s => ({ m: "lac-kara2", h: "110", splay: s, trim: 0 }))),
        group({ name: "Front fills", role: "fill", color: COLORS[2], model: "lac-x4i", mount: "lip", layout: "row", n: Math.max(3, Math.round(geo.stageW / 9)), spread: geo.stageW * .65, tilt: -8, gain: -10 }),
        group({ name: "Subs", role: "sub", color: COLORS[5], model: "lac-ks21", mount: "stack", mirror: true, off: hw - 2, dist: 2, z: 0, subN: 2, subMode: "cardioid", gain: -18 })
      ];
    }
    if (id === "lr-point" || id === "lr-point-delay") {
      const out = [
        group({ name: "Mains", role: "main", color: COLORS[0], model: "qsc-k122", mount: "pole", mirror: true, off: hw - 1.5, dist: 1.5, z: 6.5, pan: 10, tilt: 0, gain: -12, open: true }),
        group({ name: "Subs", role: "sub", color: COLORS[5], model: "qsc-ks118", mount: "stack", mirror: true, off: hw - 1.5, dist: 1.5, z: 0, subN: 1, subMode: "omni", gain: -14 })
      ];
      out[0].z = out[1].z + 2.3 + 4.2;
      if (id === "lr-point-delay") out.splice(1, 0, group({ name: "Delays", role: "delay", color: COLORS[1], model: "gen-point-90x60", mount: "flown", layout: "row", n: 2, spread: geo.W * .45, off: 0, dist: deep * .5, z: Math.min(geo.ceil - 3, 14), tilt: 18, gain: -14 }));
      return out;
    }
    return [];
  }

  function bom(groups, geo) {
    const c = new Map();
    for (const g of groups) {
      const units = unitPositions(g, geo).length, t = groupType(g);
      const add = (id, n) => c.set(id, (c.get(id) || 0) + n);
      if (t === "line") for (const b of g.boxes) add(b.m, units); else if (t === "sub") add(g.model, units * Math.max(1, g.subN | 0)); else add(g.model, units);
    }
    return [...c.entries()].map(([id, n]) => ({ m: model(id), n }));
  }

  window.Engine = { FT, C_FTS, EAR, ROLES, MOUNTS, COLORS, model, allModels, setCustom, hOpt, groupType, unitPositions, sources, srcLevel, arrival, midAt, lfAt, groupsAt, timeSpread,
    seatLevels, energyAvg, autoDelay, suggestDelays, makeTemplate, group, newId, bom, ear };
})();
