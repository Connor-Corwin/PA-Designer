# PA Designer

A browser-based 3D tool for planning sound-system coverage in a room. Build the room, place line arrays, point sources, fills, delays and subs, and see a predicted SPL map across every seat. The map updates live as you change the design.

It's a quick comparison tool, not a replacement for L-Acoustics Soundvision, d&b ArrayCalc or Meyer MAPP.

## What it does

**Rooms (Room tab)**
- Start from a preset, or shape your own:
  - Rectangle or fan: width (at the stage and at the back for a fan), depth, ceiling
  - Stage: depth, width, height, curved front
  - Seating: first-row gap, row spacing, seat width, center / side / back aisles, straight or curved rows, raised (stadium) rows at the back
  - Sound booth: size and position
- Seats fill in automatically.
- Presets:
  - The Rock Concept S14 (a fixed drawing, which can be copied into an editable fan)
  - Rectangular hall
  - Fan auditorium
  - Small chapel
  - Gym

**System (System tab)**
- Any number of speaker groups. Each group is one design element: a hang, a pair on poles, a row of front fills, a delay ring, or a sub array.
- Per group:
  - **Type:** line array, point source, or sub.
  - **Model:** from the speaker library or your own custom speaker.
  - **Mounting:** flown, on a pole / stand, ground stack, wall bracket, or in the stage front.
  - **Layout:** one unit, or a row of units. Either can be mirrored left / right.
  - **Position:** offset from the center line, distance from the stage front, height.
  - **Aim:** toe-in / pan and tilt (site angle for arrays).
  - **Line arrays:** box count; per-box type (e.g. A10i Focus / Wide), splay, horizontal option (fins / Panflex) and trim.
  - **Point sources:** horizontal option and horn rotation.
  - **Subs:** boxes per stack, cardioid or omni.
  - **Level and time:** level, delay (ms) with an **Auto** button, polarity, mute, and a lock that keeps Optimize away from the group.
- **Optimize coverage:** adjusts aim, splays, horizontal options, box trims and levels of every unlocked group for the most even coverage, then holds the seat average. Undo reverses it.

**Analyze (Analyze tab)**
- **Mid / high map:** 1–4 kHz energy sum with 3 dB contours.
- **Subs map:** phase-summed at a chosen frequency, delays and polarity included.
- **Timing map:** the spread in arrival time between the groups that are within a set window of the loudest one. It shows where fills and delays smear or echo against the mains.
- **Auto-time:** times all fills, out-fills and delays to the mains over the seats each one covers, plus a precedence offset.
- **Find seats that need a fill or delay:** flags seats more than N dB under the median and groups them into areas. It proposes a fill (near the stage) or a delay (further back) for each area, with position, height and aim. **Add** drops one in, levels it to bring that area up to the median, and times it.

**File (File tab)**
- Save designs in the browser. The current design also autosaves.
- Export / import a `.json` file.
- Equipment list (speaker counts by model).

## Speaker library

`js/speakers.js` holds common models from L-Acoustics, d&b, JBL, QSC, Electro-Voice, Martin Audio and Meyer Sound, plus generic starting points.

- Each entry has its published coverage, peak max SPL, box size and (for line arrays) allowed splay angles.
- Entries whose numbers were checked against a datasheet carry a `src` link. The app shows it as "Spec source".
- Entries without one are typical published values and are marked with `*`. Confirm them before relying on the numbers.
- **Adding a model:** copy an entry and edit it. The comment at the top of the file explains each field. You can also use **System → Custom speaker** in the app; custom speakers are saved inside the design file.

## Run it
It's a static site with no build step.
- Open `index.html` in a browser, or
- serve the folder (`npx serve .` or `python3 -m http.server`) and open the local URL.
- To publish it: Settings → Pages → deploy from the `main` branch, root folder.

three.js r128 loads from cdnjs and jsDelivr.

## Project layout
```
index.html            page markup
css/app.css           styles
js/rooms/rock-s14.js  The Rock Concept S14 drawing (window.ROCK_S14)
js/rooms.js           room builder + presets (window.Rooms)
js/speakers.js        speaker library (window.SPEAKERS)
js/engine.js          sources, level / phase / timing model, auto delay, suggestions, starter systems (window.Engine)
js/app.js             UI, 3D scene, maps, optimizer, saving
```

**Coordinates are plan feet.**
- `x` runs across the room.
- `y` runs from the back wall (0) toward the stage.

**Groups store their positions relative to the stage front and center line**, so they stay put when the room is resized:
- `off`: from the center line
- `dist`: toward the back; negative is over the stage
- `z`: height of the speaker's bottom

## The acoustic model, and its limits

**How it works**
- Each box is a point source. Its beam comes from the published coverage angles: −6 dB at the half-angle, with a quadratic roll-off.
- Line-array boxes get the vertical opening of their splay, with a floor (`vMin`) so very tight splays don't make unrealistically thin beams. The on-axis level is scaled by `vRef / opening`, which concentrates level where the array is tightly curved.
- Level is long-term pink noise, 10 dB below each model's peak max SPL, plus the level sliders.
- Mid / high sources are summed as energy.
- Subs are summed with phase, including delay and polarity. Cardioid stacks use a (1 + cos θ) / 2 pattern.
- Timing uses each group's loudest unit at each point: distance / 1125 ft/s, plus that group's delay.

**Limits**
- Direct sound only: no reflections, no air absorption, no real box-to-box coupling.
- Use it to compare layouts and spot problems, then confirm the final design in the manufacturer's software.

## Ideas
- Balconies and under-balcony fills
- Independent left / right settings
- Frequency-dependent directivity (more than one band)
- Amp channel counts per brand
- Drawing a custom room outline by clicking corners
- Installable PWA
