/* Rooms: a parametric shape builder plus fixed drawings.
 * Plan feet: x runs across the room, y runs from the back wall (0) toward the stage (y = depth).
 * buildRoom(spec) returns the geometry everything else uses:
 *   AUD (outline), STAGE (outline), lipY(x) (stage front), lipC (stage-front y at the center line), cx (center line),
 *   seats [{x, y, r, row, z}], rows (count), FOH [x0,y0,x1,y1] | null, ceil, stageH, floorAt(x, y), bbox [x0,y0,x1,y1].
 */
(function () {
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function inPoly(x, y, P) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
  function segDist(px, py, [ax, ay], [bx, by]) { const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy; let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = clamp(t, 0, 1); return Math.hypot(px - ax - t * dx, py - ay - t * dy); }

  const DEFAULT_SPEC = {
    shape: "rect", width: 60, backWidth: 90, depth: 90, ceiling: 26,
    stage: { depth: 20, width: 40, height: 3, curve: 0 },
    seating: { frontGap: 10, rowSpacing: 36, seatWidth: 21, centerAisle: 5, sideAisle: 4, backGap: 8, rowRadius: 0, stadiumRows: 0, riser: 14 },
    foh: { on: true, width: 14, depth: 9, fromBack: 4 }
  };

  function buildParametric(spec) {
    const s = spec, st = s.stage, se = s.seating;
    const D = s.depth, Wf = s.width, Wb = s.shape === "fan" ? Math.max(s.backWidth, s.width) : s.width;
    const W = Math.max(Wf, Wb), cx = W / 2;
    const AUD = [[cx - Wb / 2, 0], [cx + Wb / 2, 0], [cx + Wf / 2, D], [cx - Wf / 2, D]];
    const Ws = clamp(st.width, 8, Wf), a = Ws / 2;
    const sd = clamp(st.depth, 4, D - 20), lipC = D - sd;
    const sag = clamp(st.curve, 0, Math.min(sd - 2, a));
    let lipY, C = null, R = Infinity;
    if (sag > 0.05) {
      R = (a * a + sag * sag) / (2 * sag); C = [cx, lipC + R];
      lipY = x => { const dx = Math.min(Math.abs(x - cx), a); return C[1] - Math.sqrt(R * R - dx * dx); };
    } else lipY = () => lipC;
    const STAGE = [];
    for (let i = 0; i <= 24; i++) { const x = cx - a + (2 * a) * i / 24; STAGE.push([x, lipY(x)]); }
    STAGE.push([cx + a, D], [cx - a, D]);

    let FOH = null;
    if (s.foh.on) { const fw = s.foh.width, fd = s.foh.depth, y0 = s.foh.fromBack; FOH = [cx - fw / 2, y0, cx + fw / 2, y0 + fd]; }

    // rows: straight, or arcs around a point downstage of the first row
    const rowSp = se.rowSpacing / 12, seatW = se.seatWidth / 12;
    const y0 = lipC - se.frontGap, curved = se.rowRadius > 0, Rr = se.rowRadius;
    const rowC = curved ? [cx, y0 + Rr] : null;
    const metric = (x, y) => curved ? Math.hypot(x - rowC[0], y - rowC[1]) - Rr : y0 - y;
    const sideEdges = []; for (let i = 0; i < AUD.length; i++) { const p = AUD[i], q = AUD[(i + 1) % AUD.length]; if (!(p[1] < .01 && q[1] < .01) && !(p[1] > D - .01 && q[1] > D - .01)) sideEdges.push([p, q]); }
    const okSeat = (x, y) => {
      if (y < se.backGap || !inPoly(x, y, AUD) || inPoly(x, y, STAGE)) return false;
      if (y > lipY(x) - 3) return false;
      for (const [p, q] of sideEdges) if (segDist(x, y, p, q) < se.sideAisle + seatW / 2) return false;
      if (FOH && x > FOH[0] - 1.5 && x < FOH[2] + 1.5 && y > FOH[1] - 1.5 && y < FOH[3] + 2.5) return false;
      return true;
    };
    const seats = []; let rows = 0;
    for (let k = 0; k < 200 && seats.length < 4000; k++) {
      const d = k * rowSp; let placed = 0;
      if (!curved && y0 - d < se.backGap) break;
      if (curved && rowC[1] - (Rr + d) < se.backGap && Rr + d > W * 2) break;
      const half = se.centerAisle > 0 ? se.centerAisle / 2 + seatW / 2 : seatW / 2;
      for (const sgn of [-1, 1]) {
        for (let j = 0; j < 200; j++) {
          const sArc = half + j * seatW;
          let x, y, r;
          if (curved) { const rr = Rr + d, th = sArc / rr; if (th > Math.PI / 2) break; x = rowC[0] + sgn * rr * Math.sin(th); y = rowC[1] - rr * Math.cos(th); r = Math.atan2(rowC[1] - y, rowC[0] - x) + Math.PI; }
          else { x = cx + sgn * sArc; y = y0 - d; r = 1.5 * Math.PI; }
          if (x < -1 || x > W + 1) break;
          if (okSeat(x, y)) { seats.push({ x, y, r, row: k }); placed++; }
        }
      }
      if (placed) rows = k + 1;
      if (!placed && curved && rowC[1] - (Rr + d) < 0) break;
    }
    // stadium: the last N rows step up
    const nS = clamp(se.stadiumRows | 0, 0, rows), rise = se.riser / 12, kStart = rows - nS;
    const floorAt = nS ? (x, y) => { const m = metric(x, y); if (m < (kStart - .5) * rowSp) return 0; return Math.min(nS, Math.floor((m - (kStart - .5) * rowSp) / rowSp) + 1) * rise; } : () => 0;
    for (const p of seats) p.z = floorAt(p.x, p.y);
    return { AUD, STAGE, lipY, lipC, cx, C, R, seats, rows, FOH, ceil: s.ceiling, stageH: st.height, floorAt, bbox: [0, 0, W, D], W, D, stageW: Ws, curved: !!C };
  }

  function buildFixed(spec) {
    const g = spec.geo, lipC = g.C[1] - g.R;
    const lipY = x => { const dx = Math.min(Math.abs(x - g.C[0]), g.R * .999); return g.C[1] - Math.sqrt(g.R * g.R - dx * dx); };
    const r = g.seats.map(([x, y]) => Math.hypot(x - g.C[0], y - g.C[1]));
    const uniq = [...new Set(r.map(v => Math.round(v / 2.83)))].sort((a, b) => a - b);
    const seats = g.seats.map(([x, y, rot], i) => ({ x, y, r: rot, row: uniq.indexOf(Math.round(r[i] / 2.83)), z: 0 }));
    const xs = g.AUD.map(p => p[0]), ys = g.AUD.map(p => p[1]);
    const W = Math.max(...xs), D = Math.max(...ys);
    const stx = g.STAGE.map(p => p[0]);
    return { AUD: g.AUD, STAGE: g.STAGE, lipY, lipC, cx: g.C[0], C: g.C, R: g.R, seats, rows: uniq.length, FOH: g.FOH, ceil: spec.ceiling, stageH: spec.stageH, floorAt: () => 0, bbox: [Math.min(...xs), Math.min(...ys), W, D], W, D, stageW: Math.max(...stx) - Math.min(...stx), curved: true };
  }

  function buildRoom(spec) { return spec.shape === "fixed" ? buildFixed(spec) : buildParametric(spec); }

  const clone = o => JSON.parse(JSON.stringify(o));
  const merge = (over) => { const s = clone(DEFAULT_SPEC); for (const k of Object.keys(over)) { if (over[k] && typeof over[k] === "object" && !Array.isArray(over[k])) Object.assign(s[k], over[k]); else s[k] = over[k]; } return s; };

  const ROOM_PRESETS = [
    { id: "rock-s14", label: "The Rock, Concept S14 (474 seats, fixed drawing)", template: "rock",
      spec: () => ({ shape: "fixed", name: window.ROCK_S14.name, ceiling: 28.6, stageH: 2, geo: window.ROCK_S14.geo }) },
    { id: "hall", label: "Rectangular hall, 60' × 90'", template: "lr-line",
      spec: () => merge({ shape: "rect", width: 60, depth: 90, ceiling: 26, stage: { depth: 20, width: 44, height: 3, curve: 4 } }) },
    { id: "fan", label: "Fan auditorium, ~650 seats", template: "lr-line",
      spec: () => merge({ shape: "fan", width: 56, backWidth: 96, depth: 88, ceiling: 32, stage: { depth: 22, width: 48, height: 3.5, curve: 6 }, seating: { rowRadius: 70, stadiumRows: 5, centerAisle: 0, sideAisle: 5 } }) },
    { id: "chapel", label: "Small chapel, 40' × 60'", template: "lr-point",
      spec: () => merge({ shape: "rect", width: 40, depth: 60, ceiling: 18, stage: { depth: 14, width: 28, height: 2, curve: 0 }, seating: { frontGap: 8, sideAisle: 3.5, centerAisle: 5, backGap: 6 }, foh: { on: true, width: 10, depth: 6, fromBack: 2 } }) },
    { id: "gym", label: "Gym / multipurpose, 80' × 110'", template: "lr-point-delay",
      spec: () => merge({ shape: "rect", width: 80, depth: 110, ceiling: 24, stage: { depth: 16, width: 32, height: 2, curve: 0 }, seating: { frontGap: 12, sideAisle: 6, centerAisle: 6, backGap: 10 }, foh: { on: true, width: 12, depth: 8, fromBack: 18 } }) }
  ];

  window.Rooms = { buildRoom, inPoly, ROOM_PRESETS, DEFAULT_SPEC, merge };
})();
