# PA Designer

An app for optimizing audio PAs in a room. It is a browser-based 3D model for planning line-array coverage in a room. It shows a predicted SPL map across the seats and updates live as you change the system.

The first room is The Rock Community Church's Concept S14 auditorium: 64' × 86', 474 seats. The system modeled is L-Acoustics:
- A10i left / right hangs
- KS21i cardioid subs
- X4i front fills

## Features
**Per box**
- A10i Focus (10° vertical) or Wide (30° vertical).
- L-Fin horizontal width: 70°, 110°, or 90° asymmetric.
- A level trim.
- Add or remove boxes.

**Hang**
- Bottom height, site angle, toe-in, offset from the center line, and mains level.
- Left and right are mirrored.

**Front fills and subs**
- Front fills: on/off, count, level, tilt.
- KS21i subs: on/off, boxes per side, level.

**Maps**
- **Mid / high:** a 1–4 kHz energy sum at seated ear height, with 3 dB contours and colored seats.
- **Subs:** a phase-summed map at 40–100 Hz with a cardioid pattern. It shows the left / right interference.

**Readouts**
- Seat average, min / max, spread, the share of seats within ±3 dB, and front rows vs back rows.
- Hover any seat for its level.

**Buttons**
- **Optimize coverage** searches the Focus / Wide split, fins, box trims, aim, toe-in and fill level for the most even coverage. It then re-levels the mains to hold the average.
- **Undo** reverses an optimize run, and **Reset all** returns to the starting layout.

**Camera views**
- 3D, top, from FOH, from the stage, and side section.

## Run it
It is a static site, so there is no build step.
- Open `index.html` in a browser, or
- Serve the folder: `npx serve .` or `python3 -m http.server`, then open the local URL.
- To publish it, turn on GitHub Pages for this repo: Settings → Pages → deploy from the `main` branch, root folder.

three.js r128 loads from cdnjs and jsDelivr.

## Project layout
```
index.html            page markup
css/app.css           styles
js/app.js             scene, acoustic model, UI, optimizer
js/rooms/rock-s14.js  room definition (window.ROOM)
```

### Adding a room
Copy `js/rooms/rock-s14.js` and point the `<script>` tag in `index.html` at the new file. The coordinates are in plan feet:
- `x` runs across the room.
- `y` runs from the back wall toward the stage.

| Field | Contents |
|---|---|
| `AUD` | Room outline polygon |
| `STAGE` | Stage outline polygon |
| `C`, `R` | Center and radius of the stage-front arc (used for the front fills) |
| `FOH` | `[x0, y0, x1, y1]` for the booth |
| `seats` | `[x, y, rotation in radians]` |

The hang positions, stage height (2'), ceiling (28.6') and ear height (3'-11") are constants at the top of `js/app.js`.

## The acoustic model, and its limits
This is a quick comparison tool, not a replacement for L-Acoustics Soundvision.

**How it works**
- Each box is a point source. Its beam shape comes from the published coverage angles: −6 dB at the half-angle, with a quadratic roll-off.
- Level is a long-term pink-noise level, 10 dB below the box's peak max SPL, plus the level sliders.

| Model | Peak max SPL | Coverage |
|---|---|---|
| A10i Focus | 140 dB | 10° vertical |
| A10i Wide | 137 dB | 30° vertical |
| X4i | 116 dB | 110° axisymmetric |
| KS21i | 138 dB | — |

- Mid / high sources are summed as energy.
- Subs are summed with phase.

**Limits**
- Direct sound only: no reflections, no box-to-box coupling, no air absorption.
- The vertical beam is widened ×1.3 to stand in for array coupling.
- Use it to compare layouts, then confirm the final design in Soundvision.

## Ideas
- Independent left / right settings, delays and out-fills.
- Other speaker families from a data file.
- Saving and sharing layouts.
- A settings or BOM export.
- Installable PWA.
