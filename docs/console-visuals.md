# The live console: look and feel

The `DisPatchy-Console` page draws the platform as an illustrated French Riviera village with cobbled lanes, terracotta roofs, shuttered cottages, little gardens and market shops, ringed by fields and vineyards. Go gophers on scooters do the deliveries. Beret-wearing villagers live in the houses and run the shops. The AWS services float overhead in a raised, static cream/lavender cloud.

This page describes what you see and what each effect means on screen. It's a guide to the visuals, not to the services behind them.

## Visual theme

- **Style:** low-poly silhouettes with fine warm ink, pastel shadow bands, faint grain and sparse object-space hatching, with a light Moebius influence. Ground, fields, water and the cloud share the print treatment. Fine patterns fade at small screen sizes. Speech bubbles and labels remain readable cream-paper stickers.
- **Palette:** warm cream paper (`#f7efdf`), brown ink (`#493e37`), terracotta buttons (`#b95632`) and teal controls (`#247c73`). Delivery roads use blue (`#3766c4`); cloud communications use teal (`#1aa39a`). Each service has its own colour, used for its label marker and packets. Service icons have no pads or stands.
- **Camera:** an orthographic three-quarter view with separate compact portrait and landscape angles, fitted around the HUD and the expanded village bounds. You can orbit and zoom; panning is off. The farmland and river continue beyond the default camera.
- **Readability:** service names sit on opaque cream chips with dark ink and coloured markers. Those labels keep their contrast as the scene lighting changes.
- **Accessibility:** reduced motion freezes rain, flames, smoke and route dashes, and suppresses ground splashes, ignition bursts, lightning and the screen-edge pulse. Screen readers hear the incident count, not every ticking timer.

![The French Riviera village in clear daylight](console-village.jpg)

## The village

| Element | What it is |
|---|---|
| Shops | Boulangerie 🥐, Librairie 📚 and Marché 🥬: striped awnings, roof tiles, side windows, shutters, planters and crates of bread, books or produce. Baguette and wine posters decorate side walls, with a wine barrel beside the market. Individual signs replace the shared “Shops” label. Footpaths meet at the collection square beside a fountain. Shopkeepers hop when an order is placed. |
| Houses | The big cottage has a dormer and a little fenced back garden. Two Orchard Row cottages turn at different angles; the blush cottage has sage shutters and another garden. Pale stone walls, blue gates, lavender pots and seating give the gardens a shared style. The red-roofed cottage remains the neighbour. |
| Residents | A person in each customer house. They step out to collect a delivered parcel, bounce on the doorstep and go back in. They hop in the doorway when an email arrives. |
| Courier depot | Across the river branch, on the west side of the depot lane with its doors facing the road. Stone door trim, a striped loading canopy, parcel crates and an adjoining scooter garage give it a rural delivery-office feel. Its label sits below the building. Job offers land here. |
| Roads | Cobbled high street, Orchard Row and depot lane. The town road continues past the foreground with cars travelling in both directions. Longer blue dashes distinguish delivery roads from shorter teal cloud links; both use 50% opacity. Amber and red still show warnings and failures. |
| River | Turquoise water, pale banks, restrained ripples, a few stones and small reed clumps clear of roads and footpaths. Both branches continue beyond the village. Two low-poly stone bridges clear the vehicles. The bookshop and its footpath sit back from the bank. |
| Fields | Rolling patchwork farmland with softly painted edges: planted vineyards, lavender rows, hedges and hay bales follow gentle hills. Wine barrels sit at the vineyard edge. A small flower field comes off the village, using painted flowers with a few foreground blooms. The village and river valley remain flat. Raised scenery avoids the river banks. |
| Trees and lamps | Round deciduous trees and tall cypresses placed by a fixed seed, so the village is the same on every load. Capped village lanterns glow after dark. |
| Foreground | Subtle grass grain and sparse flower clusters soften the paper ground, clear of the river and roads. |

## The cloud

Each service is a glowing 3D icon, with a cream label and colour marker. The higher,
centred cluster includes Billing. The icons glow faintly so night and bad weather
never grey them out. Cream/lavender cloud lobes share the village's ink shading;
reduced bloom retains their texture. Cloud, icons and message endpoints share one
placement offset. There are no coloured pads. Tablets retain compact labels with
short leader lines; phones provide a named service key inside Village desk.

| Service | Icon |
|---|---|
| Orders | A receipt |
| Dispatch | A signpost |
| Tracking | A map pin |
| Proof | A camera |
| Notifications | An envelope |
| Billing | Alternating light gold and amber coins with distinct rims |
| EventBridge | A little yellow bus |

Short teal dashed conduits arc between the services. Packets fly along them: parcels for orders, letters for emails and offers, coins for billing, small dots for courier positions. The icon and its label hop when a packet lands. Reduced motion freezes their animation. A route legend in Village pace labels delivery roads and cloud messages.

## Couriers

Gophers with shaped heads, bodies, ears and paws, oversized eyes, muzzles, two teeth and warm helmets ride rounded scooters loaded with taped parcels.
Pastel compact cars with taller framed windscreens, rounded roofs, cream bumpers
and round headlamps share the lanes, including the road to other towns. Cars and
couriers mount directly on their lanes; jam cars follow the bends. Car lanes sit
inside both bridge parapets.

1. After accepting a job, a courier rides out of the depot, up the depot lane and along the high street to the shops' square.
2. A "🏪📦 Collecting" bubble shows while they pick up.
3. They ride on to the order's house, along the high street or Orchard Row.

Couriers on the same stretch ride side by side. After dark and in storms, each scooter switches on a headlamp with a soft beam along the road.

## Speech bubbles

| Where | Bubble |
|---|---|
| Shops | 🛍️📦 New order! |
| Courier depot | 📨 Job offer, then 👍🛵 On my way |
| Customer house | ✉️✅ Email accepted, after `NotificationAccepted`; 📸✅ Delivered, after `OrderDelivered` |
| Courier | 🏪📦 Parcel collected, after `OrderCollected` |
| Billing and shop | 🏪💲 Line item, after `BillingLineRecorded` |

## Time of day and weather

- **Day and night:** demo mode runs a fast day (two minutes, starting at 7am). Dawn and dusk go warm orange; night turns the sky moonlit blue, with glowing windows and lamps. Live mode follows the viewer's local clock.
- **Sunshine:** clear days get a stronger sun and a soft bloom glow.
- **Rain:** fine, varied streaks, small ground splashes and a cool blue cast. The streaks stay translucent so they do not obscure the scene.
- **Storms:** heavier rain, a darker blue-grey sky and brief lightning flashes. Reduced motion disables flashes and splashes.
- **Peak hours:** lunchtime and early evening bring more orders at once.
- **Time dial:** displays and sets the scene's 24-hour clock. Drag around the face, use keyboard arrows, or select daytime/nighttime. A manual selection holds until Auto restores the clock.
- **Weather dial:** clear, rain and storm buttons share the face with the displayed condition. Auto restores simulated demo weather or clear live skies.
- **Live appearance:** manual sky controls are labelled "Scene only · no weather feed". They change the picture while event, ping, arrival, billing and failure clocks keep their real timing.

In demo mode, rain, storms, peak hours and heavy traffic all stretch deliveries out. Live mode defaults to clear skies because the console has no weather feed. Manual live weather is an appearance override; it makes no claim about real conditions or delivery speed.

![The village in sunshine, moonlight, rain and a storm](console-weather.jpg)

## Compact layouts

Desktop keeps slim side panels and pace along the bottom. Phones and tablets at
1100px or below use a fixed Village desk summary showing parcels, cars, incidents
and running test progress. Open it for the test, all order rows, both sliders and
the named cloud-service key. The panel overlays the village without changing
camera framing; its controls stay mounted when closed. The time/weather summary
opens both sky dials. Native disclosures support keyboard and touch.
Tablets retain compact service labels. Phones hide shop names, the Neighbour and
depot labels, retaining shop icons and operational speech bubbles.
Short landscape screens use a small desk at the right. Both overlays can scroll
while their summaries remain accessible.

![The tablet view with readable service labels and the expandable Village desk](console-tablet.jpg)

![The phone view with compact sky controls and more space for the village](console-mobile.jpg)

## Village pace: the sliders

The "Village pace" panel sits along the bottom and has two sliders, each up to 20. Hover a slider for what it controls.

- **Deliveries in progress:** how many orders are on their way. In the demo you set how many the shops keep in flight, and the count moves towards it. Live, it's the real number, read-only.
- **Other traffic:** the displayed count is cars currently in view, including queues and town-road traffic. The demo slider sets the cruising target shown beneath it. The current count can vary as cars leave the foreground, queues appear or the camera moves; the target stays where you set it. Live cruising traffic follows real event volume, with no demo volume carried across mode changes.

## When things go wrong

Problems escalate from quiet to loud.

**Quiet oddities** show in amber:

- **Wrong address:** a courier wanders off the road, up the garden path to the neighbour's door, with "🤔📦 Is this the right house?", then rides back. Tracking says "🧭❓ That's not on the map".
- **Delivered twice:** the customer's cottage asks "📦📦❓ Delivered… again?".
- The event stream shows an amber ⚠️ line, and the affected route lines and conduits turn amber.

**Stuck deliveries** show in red:

1. **Jam:** a courier that goes quiet stops where it is. Cars queue nose to tail behind it, honking ("📢🚗🚗 HONK! Stuck in traffic"). Other couriers and cars on the same road stop behind the jam.
2. **Fire:** if it stays stuck, the scooter tips over and burns, with "🔥🛵🔥 Courier down". A brief cartoon ignition puff leads into layered flames, drifting smoke and small embers. Reduced motion suppresses the burst and freezes the ongoing effect.
3. **Lost:** shortly after, the order disappears, and the event stream logs a red "🕳️ LOST" line saying how far it got.

An order that never gets a courier sets the Dispatch icon smouldering, then burning and rattling, with an incident marker on its label. Its route lines and the conduit where it stopped turn red.

**Alerts:** while anything is stuck, a red, gently shaking "🚨 INCIDENTS" banner sits above the desktop pace strip or below the compact header, and the edges pulse red. Each line describes the delivery, for example "has stopped on its way to the customer" or "won't arrive: no courier took the job".

## The smoke test

In Live mode, the smoke-test button sends one real order through the deployed system from start to finish. In Demo mode it plays a pretend run. Either way the test order is easy to pick out:

- New demo traffic pauses, so the test delivery has the village to itself.
- Its courier rides inside a pulsing violet ring under a "🧪 Test delivery" flag.
- Its row in Orders in flight is outlined in violet and labelled "🧪 test".
- The step list ticks off as it goes. A passed run folds the list away and shows a green verdict. A failed run keeps the list and adds "💥 The test delivery failed while …" to the alerts.

The panel is labelled "Test a little parcel", with a "Send test parcel" button. "Village activity" is the event stream,
and "Parcels on their way" is the order timeline. Friendly labels retain the same operational behaviour.

The mode control reads **Sign In** before authentication and **Live** afterwards.
Live mode also offers bounded backend scenarios and displays the last prepared test
fleet's vehicle identities and actual availability. Completed scenarios keep their
observations visible. A passing parcel test confirms delivery; email acceptance and
billing completion require their own events. The timeline shows **billing pending**
until a real line item is recorded.

## Editing the look

The colour and component reference is [`web/console/styleAesthetic.md`](../web/console/styleAesthetic.md).
Seventeen shared Blender meshes live in a 235KB GLB kit. Their materials still use the
existing cel shader and ink outlines. The editable Blender sheet and rebuild script are
in [`docs/models/`](models/). Building footprints and doorstep positions stay aligned with courier routes.

The kit contains roof, shutters, window frame, door frame, chimney, lantern cap, cypress,
fountain, car body, car cabin, scooter, parcel, cloud puff, soft box, bridge, bread and gopher meshes.
The rebuild script replaces its generated Blender scene while preserving unrelated scenes.
Model tests check names, orientation, roof faces and the triangle/file budgets; vineyard tests check bank clearance.

## Timing and scope

The scene controls operate independently of event timestamps. Manual demo time and
weather affect subsequent simulated deliveries; they do not backdate existing pings,
retune stalled/burning/lost thresholds or change billing confirmation. Live mode still
uses real events and existing authentication, with scene-only weather overrides.

The depot and town-road visuals leave courier delivery routes intact. Traffic cars
also use the town road; they turn beyond the foreground while its paving continues
towards other towns. Village, tablet and phone images show the illustrated detail
pass. Older smoke-test and weather images retain the earlier layout; current sky
modes and operational feedback were checked separately in the running preview.
