/* Speaker library.
 * type: "line" (line-array element), "point" (point source), "sub".
 * maxSpl: published peak max SPL at 1 m (dB). The model runs at maxSpl − 10 dB (long-term pink noise) plus the level sliders.
 * h: horizontal options. Each has a label and the −6 dB half-angles toward the room center ("in") and away from it ("out").
 * Point sources: v = vertical coverage (deg); rot = horn can be rotated (swaps H and V).
 * Line elements: splays = allowed angles to the next box down (deg); vRef = the opening the max SPL refers to;
 *   vMin = the narrowest opening the model will give one box (it stops very tight splays from making unrealistically thin beams).
 *   Constant-curvature boxes (A10i, A15i, KLA) have one fixed splay: the box's own curvature.
 * family: boxes in the same family can be mixed in one array (A10i Focus + Wide).
 * dims: [height, width, depth] in mm.
 * src: the datasheet / product page the coverage and max SPL were checked against. null = typical published value, not re-checked here.
 */
(function () {
  const H = {
    sym: deg => ({ id: String(deg), label: `${deg}°`, in: deg / 2, out: deg / 2 }),
    asym: (label, i, o, id) => ({ id, label, in: i, out: o })
  };
  const FINS = [H.sym(70), H.sym(110), H.asym("90° wide in", 55, 35, "90in"), H.asym("90° wide out", 35, 55, "90out")];
  const one = deg => [H.sym(deg)];
  const range = (a, b, s = 1) => { const o = []; for (let v = a; v <= b + 1e-9; v += s) o.push(+v.toFixed(2)); return o; };
  const VTX_SPLAYS = [0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 6, 8, 10];

  window.SPEAKERS = [
    // ---------- L-Acoustics
    { id: "lac-a10i-focus", brand: "L-Acoustics", model: "A10i Focus", type: "line", family: "lac-a10", splays: [10], vRef: 10, vMin: 10, maxSpl: 140, h: FINS, dims: [350, 570, 366], src: null },
    { id: "lac-a10i-wide", brand: "L-Acoustics", model: "A10i Wide", type: "line", family: "lac-a10", splays: [30], vRef: 30, vMin: 30, maxSpl: 137, h: FINS, dims: [348, 570, 366], src: null },
    { id: "lac-a15i-focus", brand: "L-Acoustics", model: "A15i Focus", type: "line", family: "lac-a15", splays: [10], vRef: 10, vMin: 10, maxSpl: 142, h: FINS, dims: [448, 786, 470], src: null },
    { id: "lac-a15i-wide", brand: "L-Acoustics", model: "A15i Wide", type: "line", family: "lac-a15", splays: [30], vRef: 30, vMin: 30, maxSpl: 139, h: FINS, dims: [448, 786, 470], src: null },
    { id: "lac-kara2", brand: "L-Acoustics", model: "Kara II", type: "line", family: "lac-kara2", splays: [0, 1, 2, 3, 4, 5, 7.5, 10], vRef: 10, vMin: 2, maxSpl: 142, h: FINS, dims: [250, 733, 482], src: "https://www.babbel-haeger.de/fileadmin/babbel-haeger/downloads/KARA_II_SPS_EN_1.1.pdf" },
    { id: "lac-kiva2", brand: "L-Acoustics", model: "Kiva II", type: "line", family: "lac-kiva2", splays: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12.5, 15], vRef: 15, vMin: 3, maxSpl: 138, h: one(100), dims: [165, 729, 351], src: null },
    { id: "lac-k2", brand: "L-Acoustics", model: "K2", type: "line", family: "lac-k2", splays: range(0, 10, 0.5), vRef: 10, vMin: 1.5, maxSpl: 147, h: FINS, dims: [344, 1338, 520], src: null },
    { id: "lac-x4i", brand: "L-Acoustics", model: "X4i", type: "point", v: 110, rot: false, maxSpl: 116, h: one(110), dims: [126, 126, 112], src: null },
    { id: "lac-5xt", brand: "L-Acoustics", model: "5XT", type: "point", v: 110, rot: false, maxSpl: 121, h: one(110), dims: [165, 165, 150], src: null },
    { id: "lac-x8", brand: "L-Acoustics", model: "X8", type: "point", v: 100, rot: false, maxSpl: 129, h: one(100), dims: [250, 250, 240], src: null },
    { id: "lac-x12", brand: "L-Acoustics", model: "X12", type: "point", v: 60, rot: true, maxSpl: 136, h: one(90), dims: [430, 430, 330], src: "https://l-acoustics.com/products/x12" },
    { id: "lac-x15", brand: "L-Acoustics", model: "X15 HiQ", type: "point", v: 60, rot: true, maxSpl: 138, h: one(40), dims: [500, 500, 380], src: null },
    { id: "lac-ks21", brand: "L-Acoustics", model: "KS21(i)", type: "sub", maxSpl: 138, dims: [533, 700, 823], src: null },
    { id: "lac-ks28", brand: "L-Acoustics", model: "KS28", type: "sub", maxSpl: 143, dims: [550, 1340, 900], src: "https://l-acoustics.com/products/ks28" },
    { id: "lac-sb18", brand: "L-Acoustics", model: "SB18(i)", type: "sub", maxSpl: 136, dims: [550, 700, 707], src: null },

    // ---------- d&b audiotechnik
    { id: "db-y8", brand: "d&b", model: "Y8", type: "line", family: "db-y", splays: range(0, 14, 1), vRef: 14, vMin: 2, maxSpl: 139, h: one(80), dims: [257, 630, 375], src: "https://www.dbaudio.com/global/en/products/series/y-series/y8/" },
    { id: "db-y12", brand: "d&b", model: "Y12", type: "line", family: "db-y", splays: range(0, 14, 1), vRef: 14, vMin: 2, maxSpl: 139, h: one(120), dims: [257, 630, 375], src: "https://www.dbaudio.com/global/en/products/series/y-series/y12" },
    { id: "db-e8", brand: "d&b", model: "E8", type: "point", v: 50, rot: true, maxSpl: 129, h: one(90), dims: [390, 232, 223], src: "https://www.dbaudio.com/global/en/products/series/e-series/e8/" },
    { id: "db-y10p", brand: "d&b", model: "Y10P", type: "point", v: 40, rot: true, maxSpl: 140, h: one(110), dims: [530, 256, 380], src: null },
    { id: "db-ysub", brand: "d&b", model: "Y-SUB", type: "sub", maxSpl: 136, dims: [530, 630, 590], src: null },

    // ---------- JBL
    { id: "jbl-vtx-a8", brand: "JBL", model: "VTX A8", type: "line", family: "jbl-a8", splays: VTX_SPLAYS, vRef: 10, vMin: 2, maxSpl: 139, h: one(110), dims: [227, 761, 375], src: "https://soundpro.com/products/jbl-vtx-a8" },
    { id: "jbl-vtx-a12", brand: "JBL", model: "VTX A12", type: "line", family: "jbl-a12", splays: VTX_SPLAYS, vRef: 10, vMin: 1.5, maxSpl: 146, h: one(90), dims: [330, 1118, 495], src: "https://jblpro.com/ar/products/vtx-a12/1001" },
    { id: "jbl-srx815p", brand: "JBL", model: "SRX815P", type: "point", v: 50, rot: false, maxSpl: 136, h: one(90), dims: [700, 440, 430], src: null },
    { id: "jbl-srx828sp", brand: "JBL", model: "SRX828SP", type: "sub", maxSpl: 139, dims: [1100, 610, 690], src: null },

    // ---------- QSC
    { id: "qsc-kla12", brand: "QSC", model: "KLA12", type: "line", family: "qsc-kla", splays: [18], vRef: 18, vMin: 18, maxSpl: 131, h: one(90), dims: [381, 594, 422], src: "https://www.qscaudio.com/resource-files/productresources/spk/kla/q_spk_kla_specs.pdf" },
    { id: "qsc-k122", brand: "QSC", model: "K12.2", type: "point", v: 75, rot: false, maxSpl: 132, h: one(75), dims: [606, 356, 351], src: null },
    { id: "qsc-kla181", brand: "QSC", model: "KLA181", type: "sub", maxSpl: 135, dims: [547, 594, 653], src: "https://www.qscaudio.com/resource-files/productresources/spk/kla/q_spk_kla_specs.pdf" },
    { id: "qsc-ks118", brand: "QSC", model: "KS118", type: "sub", maxSpl: 136, dims: [668, 551, 754], src: null },

    // ---------- Electro-Voice
    { id: "ev-x1-212-90", brand: "Electro-Voice", model: "X1-212/90", type: "line", family: "ev-x1", splays: range(0, 10, 1), vRef: 10, vMin: 2, maxSpl: 143, h: one(90), dims: [343, 731, 534], src: "https://products.electrovoice.com/na/en/x1-21290" },
    { id: "ev-etx12p", brand: "Electro-Voice", model: "ETX-12P", type: "point", v: 50, rot: true, maxSpl: 134, h: one(90), dims: [640, 381, 376], src: null },
    { id: "ev-etx18sp", brand: "Electro-Voice", model: "ETX-18SP", type: "sub", maxSpl: 135, dims: [668, 551, 754], src: null },

    // ---------- Martin Audio
    { id: "ma-cdd12", brand: "Martin Audio", model: "CDD12", type: "point", v: 60, rot: true, maxSpl: 128, h: [{ id: "cdd", label: "110°→60° (CDD)", in: 42, out: 42 }], dims: [560, 360, 350], src: "https://martin-audio.com/products/loudspeakers/cdd12" },

    // ---------- Meyer Sound
    { id: "meyer-ultra-x40", brand: "Meyer Sound", model: "ULTRA-X40", type: "point", v: 50, rot: true, maxSpl: 138, h: one(110), dims: [567, 318, 356], src: "https://docs.meyersound.com/products/en/datasheet---ultra-x40.html" },
    { id: "meyer-ultra-x42", brand: "Meyer Sound", model: "ULTRA-X42", type: "point", v: 50, rot: true, maxSpl: 138, h: one(70), dims: [567, 318, 356], src: "https://docs.meyersound.com/products/en/datasheet---ultra-x40.html" },

    // ---------- Generic starting points (edit or copy into a custom speaker)
    { id: "gen-point-90x60", brand: "Generic", model: "Point source 90×60", type: "point", v: 60, rot: true, maxSpl: 130, h: one(90), dims: [600, 380, 380], src: null },
    { id: "gen-line-10", brand: "Generic", model: "10\" line element 100°", type: "line", family: "gen-line", splays: range(0, 10, 1), vRef: 10, vMin: 2, maxSpl: 138, h: one(100), dims: [280, 700, 450], src: null },
    { id: "gen-sub-18", brand: "Generic", model: "18\" sub", type: "sub", maxSpl: 134, dims: [600, 550, 700], src: null }
  ];
})();
