# Lunar South Pole Site Explorer — the simple version

## What is it?

A website that answers one question: **"If we land here, on this date, will the lander have sunlight
and a radio link to Earth — and what happens if we're a few days late?"**

## Why is that hard?

Picture the Moon's south pole like this:

- **The Sun never gets high.** It crawls along the horizon, never more than about the width of three
  Suns above it. It goes all the way round the sky once a month instead of rising and setting every day.
- **So hills block it.** A mountain far away — sometimes 50–100 km — can hide the Sun for days. Being
  on a high ridge means light; being in a crater means darkness, sometimes forever.
- **The Earth wobbles.** From the Moon, the Earth stays in almost the same spot but rocks back and
  forth a little. Sometimes that's enough for it to dip behind a hill — and then you can't call home.
- **Timing is everything.** The same spot can be sunny for two weeks, and ten days later be stuck in a
  four-day night. For a solar-powered lander that can be the end of the mission.

## What does the app do?

- Shows a **map of the south pole** made from real NASA laser measurements of the terrain, lit by the
  real Sun for any date you pick. You can watch the shadows sweep around as time passes.
- For any spot you choose, it **looks out to the horizon in every direction** (up to 300 km away)
  and tells you:
  - how much of the time the Sun is visible,
  - the longest stretch of darkness,
  - how often the Earth is visible (for radio),
  - how long until sunset or sunrise, and until Earth disappears or reappears.
- Lets you **compare up to four plans** and drag a slider to see **what changes if the launch slips**.
- Can **suggest good spots** on the map (not too steep, lots of light, Earth in view).
- Lets you **stand on the surface** in 3D and look around: the Sun skimming the hills, the Earth low in
  the black sky.

## Is it accurate?

We checked our Sun and Earth positions against NASA/JPL's own service (JPL Horizons). The difference
is less than a thousandth of a degree. Our long-term light maps also match the maps published by NASA
scientists very closely.

## What is it made of? (technologies)

- **Real NASA data:** terrain heights from the Lunar Reconnaissance Orbiter's laser altimeter (LOLA),
  and Sun/Earth positions from NASA/JPL's SPICE toolkit.
- **In your browser:** TypeScript, Preact (the interface), OpenLayers (the map), WebGL2 graphics shaders
  (lighting and shadows on the graphics card), three.js (the 3D walk-around view), Web Workers
  (calculations in the background so nothing freezes).
- **Behind the scenes:** Python with NumPy and Numba (fast number crunching), SpiceyPy (space
  positions), rasterio (reading the terrain files), FastAPI (an optional calculation server).
- **Packaging:** Docker, so the whole thing starts with one command.
- The fine rocky texture, the stars and the picture of the Earth are **drawn by the computer
  (synthetic)**, not photos — the app says so.

## How to use it

1. **Skip the intro** (any key) or enjoy the 9-second flight to the pole.
2. **Pick a place.** On the left, click a site from the list (for example *Connecting ridge*) — or just
   click anywhere on the map.
3. **Read the verdict.** Top right says *Viable*, *Marginal* or *Risky*, with three numbers: sunlight,
   longest night, Earth contact.
4. **Look at the sky picture.** The grey shape is the horizon (the hills around you). The yellow line is
   where the Sun goes, the blue loop is where the Earth wobbles. The two small boxes zoom in on the Sun
   and the Earth so you can see if a hill is cutting them off.
5. **Play with time.** At the bottom, press **▶ Play** to watch a lunar day go by, or drag the white
   line. Drag the yellow handles to choose your mission dates.
6. **Try other map layers** (top left of the map): *Shadows now*, *Illumination %* (yellow = lots of
   light), *Earth visibility %*, *Longest night*, *Slope*, *Suitability*.
7. **Compare plans.** Press **+ Pin current site & interval**, choose another site or date and pin it
   too. Then drag **What if it slips?** — the cards show what gets better or worse.
8. **Go for a walk.** Press **Stand here**, then click on the map. Look around by dragging the mouse,
   walk with **W A S D**, run with **Shift**. **← Map** takes you back.
9. **Share it.** The **Share** button copies a link that opens exactly what you see.

Handy keys: `Space` — play/pause, `M` — map, `P` — panorama, `←/→` — move time by an hour.

Switch between **Explorer** (simple) and **Planner** (all the numbers) at the top right.
