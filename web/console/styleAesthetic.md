# Village style

A warm, low-poly French Riviera village drawn with cream paper, terracotta, teal, and brown ink.
Use chunky silhouettes, faceted surfaces, simple details, and gentle bounce.

## Palette

| Role | Colour |
| --- | --- |
| Paper / panel | `#f7efdf` / `#fffaf0` |
| Ink / text / muted | `#493e37` / `#3d3631` / `#75675c` |
| Teal action | `#247c73` |
| Terracotta action | `#b95632` |
| Success / error | `#366e4c` / `#b74036` |
| Model roof / shutters / water | `#bd6c49` / `#6e9eab` / `#70c4c0` |
| Cloud puffs | `#edf3ef` / `#f7faf6` |

Keep semantic labels alongside colours. Scene lighting changes with time and weather;
the HUD stays on warm paper. Small event headings use ink, with colour on the side marker.
Service names use opaque paper chips with dark ink and small coloured markers, retaining
contrast through night, rain, and storms. The cloud is smaller, static and white, with thin outlines;
service icons have no coloured pads. Their landing hops, fire and incident labels retain operational feedback.
Decorative cloud patches are removed.

## Type and spacing

Use the existing rounded font stack, with Avenir Next and system fallbacks.
Brand: 27px/800 (24px on phones). Panel headings: 14px/800, sentence case.
Body: 14px/1.4. Supporting text: 12–13px. IDs and timings use monospace.
Use a 4px spacing scale: 4, 8, 12, 16, 20, 24. Panels have 16px padding and gaps.
Panels use 18px corners, buttons 14px or pill corners, and rows 10–12px corners.
Borders are 2px ink. Cards retain hard ink shadows of 4px by 5px.

## Component states

- Buttons: clear filled or paper default, darker hover, pressed shadow, 3px teal focus,
  disabled cursor and subdued mode tabs. The test button shows progress and blocks another run.
- Inputs: paper fill, ink border, teal keyboard focus. Errors appear in red text beside the form.
  Sign-in blocks repeat submissions while loading.
- Panels: friendly sentence-case headings. Empty deliveries show a short message.
  Test steps retain running, passed, failed, and pending labels and symbols.
- Incidents: preserve the red alert card, text, and siren. Do not soften operational failures.
- Loading: a paper badge while the local mesh kit loads. Reduced motion removes CSS movement,
  freezes rain, fire and smoke, and suppresses splashes, ignition bursts and lightning.

## Responsive layout

Desktop puts the test at left, activity and parcels at right, and pace at the bottom.
At 1100px and below, use compact test and parcel cards above a full-width pace strip.
Hide the activity feed, keep the scene labels on paper and retain both sliders. Compact cloud labels stay anchored to their icons; short leader lines separate crowded names.
At 760px, order IDs, stages and tracks use separate rows so long failure labels fit.
Keep the middle of the desktop view free for orbiting the village. Fit the shops, couriers and service icons around the HUD. Short landscape screens put the HUD in a scrollable left column. Short phones show one order row to leave more room for the village.

## Assets

`src/scene/models/french-village.glb` contains 17 reusable meshes, 235KB total.
`src/scene/Models.tsx` reuses the existing `Toon` material and ink outlines.
Buildings keep their original footprints and doors so courier paths still meet them.
The Blender source and rebuild script live in `docs/models/french-village.blend` and
`docs/models/french-village.py` at the repository root. Run the script in Blender to rebuild.
Models export at the origin in Y-up coordinates; the saved Blender sheet uses Z-up.
Keep each mesh under 800 triangles and the kit under 250KB.
Awning stripes and cobbles use small, local canvas textures; no remote textures or model services.
Crop fields and vineyards extend beyond the camera. Raised vines, hedges and hay bales
keep bank clearance around both river branches.
The farmland shares a gently rolling surface with its painted crop patches, keeping
the village and river valley flat. Foreground grain and sparse flowers add detail.

## Time, sky and traffic controls

The two circular widgets combine display and input: cream faces, brown ink outlines,
teal clock hands and terracotta selection marks. The clock is a 24-hour dial with
quarter-hour selection, keyboard arrows, pointer/touch dragging, day/night presets
and Auto reset. Clear, rain and storm buttons sit inside the weather face.
Selected buttons show a visible terracotta mark; all controls keep a teal focus ring.
Small screens retain both widgets. Connection/error status appears only in Live mode.

Manual scene time holds until Auto is selected; automatic demo days and weather
continue to run in the background. Live overrides are labelled as scene appearance,
with no real weather feed. They never change event timestamps or delivery health.

Other traffic displays cars currently in view, including jams and cars on the town
road. The demo slider sets the cruising target, shown beneath it; camera movement
and queue changes update the current count without moving the requested target.
Live cruising traffic follows real event volume and is read-only.
