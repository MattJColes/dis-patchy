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
service icons retain their coloured pads, landing hops and burning-state colours.
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
Hide the activity feed, shrink scene labels and retain both sliders.
At 760px, order IDs, stages and tracks use separate rows so long failure labels fit.
Keep the middle of the desktop view free for orbiting the village.

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

## Requested controls

The requested time/weather controls would use compact circular paper faces, ink
outlines, teal clock hands, terracotta selection marks and clear weather symbols.
They should combine input and displayed value, with keyboard and touch support.
These interactive controls are not implemented in this appearance pass.
