# The live console: look and feel

The `DisPatchy-Console` page draws the platform as a small cartoon village: a medieval French village with cobbled lanes, cottages and market shops, ringed by farmland. Go gophers on scooters do the deliveries. People live in the houses and run the shops. The AWS services float overhead in a puffy, duct-taped cloud, as in the README banner.

This page describes what you see and what each effect means on screen. It's a guide to the visuals, not to the services behind them.

## Visual theme

- **Style:** flat cel shading with an ink outline on every object, in a toon look. Speech bubbles and labels are drawn like comic-strip stickers: cream paper, thick ink border, hard drop shadow.
- **Palette:** cream paper (`#f6efdf`), ink (`#2b2f3a`) and a teal route colour (`#1aa39a`). Each service has its own colour, used for its plinth, label and packets.
- **Camera:** a fixed orthographic three-quarter view. You can orbit and zoom a little; panning is off. On phones the panels stack below the scene.
- **Accessibility:** with reduced motion turned on, the rain, flames and route dashes stop moving and the screen-edge pulse is static. Screen readers hear the incident count, not every ticking timer.

## The village

| Element | What it is |
|---|---|
| Shops | Three market shops with striped awnings (bakery 🥐, bookshop 📚, grocer 🥬), each with a footpath to the cobbled square where couriers collect. Shopkeepers hop when an order is placed. |
| Houses | The big cottage at the end of the high street, and Orchard Row: three smaller cottages at odd angles along a side lane. Two are customers; the red-roofed one in the middle is the neighbour. |
| Residents | A person in each customer house. They step out to collect a delivered parcel, bounce on the doorstep and go back in. They hop in the doorway when an email arrives. |
| Courier depot | Out on its own bank across the river's branch, reached by the depot lane and a small bridge. Job offers land here. |
| Roads | The high street from the square to the end cottage, Orchard Row looping off it, and the depot lane. Dashed route lines run along each one. |
| River | It splits in two south of the high street. Two bridges cross it: one on the high street, one on the depot lane. |
| Fields | Patchwork farmland behind the village: crop strips, a lavender field, hedgerows and haystacks. |
| Trees and lamps | Low-poly trees placed by a fixed seed, so the village is the same on every load. Street lamps glow after dark. |

## The cloud

Each service is a glowing 3D icon on a coloured plinth. The icons glow faintly in their own colour so night and bad weather never grey them out.

| Service | Icon |
|---|---|
| Orders | A receipt |
| Dispatch | A signpost |
| Tracking | A map pin |
| Proof | A camera |
| Notifications | An envelope |
| Billing | A stack of coins |
| EventBridge | A little yellow bus |

Dashed conduits arc between the services. Packets fly along them: parcels for orders, letters for emails and offers, coins for billing, small dots for courier positions. A plinth hops when a packet lands on it.

## Couriers

Gophers ride scooters loaded with parcels.

1. After accepting a job, a courier rides out of the depot, up the depot lane and along the high street to the shops' square.
2. A "🏪📦 Collecting" bubble shows while they pick up.
3. They ride on to the order's house, along the high street or Orchard Row.

Couriers on the same stretch ride side by side. After dark and in storms, each scooter switches on a headlamp with a soft beam along the road.

## Speech bubbles

| Where | Bubble |
|---|---|
| Shops | 🛍️📦 New order! |
| Courier depot | 📨 Job offer, then 👍🛵 On my way |
| Customer house | ✉️📦 Email: order confirmed, ✉️🛵 Email: courier on the way, 📸✅ Delivered |
| Billing | 🏪💲 Line item |

## Time of day and weather

- **Day and night:** demo mode runs a fast day (two minutes, starting at 7am). Dawn and dusk go warm orange; night turns the sky moonlit blue, with glowing windows and lamps. Live mode follows the viewer's local clock.
- **Sunshine:** clear days get a stronger sun and a soft bloom glow.
- **Rain:** falling streaks and a cool blue cast over everything.
- **Storms:** heavier rain, a darker blue-grey sky and lightning flashes.
- **Peak hours:** lunchtime and early evening bring more orders at once.
- **The sky chip:** in the top bar, it shows the time, an icon for the sky you'd see (☀️, 🌙, 🌧️ or ⛈️), "🚦 Peak hour" and, in the demo, "deliveries slower".

In demo mode, rain, storms, peak hours and heavy traffic all stretch deliveries out. Live mode only shows clear skies, because the console has no weather data.

## How busy: the sliders

The "How busy" panel has two sliders, each up to 20.

- **Deliveries in progress:** how many orders are on their way. In the demo you set how many the shops keep in flight, and the count moves towards it. Live, it's the real number, read-only.
- **Other traffic:** cars driving the high street, Orchard Row and the depot lane, standing for other requests sharing the system. In the demo, more cars mean slower deliveries and more jams. Live, the car count follows the volume of events flowing through.

## When things go wrong

Problems escalate from quiet to loud.

**Quiet oddities** show in amber:

- **Wrong address:** a courier wanders off the road, up the garden path to the neighbour's door, with "🤔📦 Is this the right house?", then rides back. Tracking says "🧭❓ That's not on the map".
- **Delivered twice:** the customer's cottage asks "📦📦❓ Delivered… again?".
- The event stream shows an amber ⚠️ line, and the affected route lines and conduits turn amber.

**Stuck deliveries** show in red:

1. **Jam:** a courier that goes quiet stops where it is. Cars queue nose to tail behind it, honking ("📢🚗🚗 HONK! Stuck in traffic"). Other couriers and cars on the same road stop behind the jam.
2. **Fire:** if it stays stuck, the scooter tips over and burns, with "🔥🛵🔥 Courier down".
3. **Lost:** shortly after, the order disappears, and the event stream logs a red "🕳️ LOST" line saying how far it got.

An order that never gets a courier sets the Dispatch plinth smouldering, then burning and rattling. Its route lines and the conduit where it stopped turn red.

**Alerts:** while anything is stuck, a red, gently shaking "🚨 INCIDENTS" banner sits at the bottom of the screen and the edges pulse red. Each line describes the delivery, for example "has stopped on its way to the customer" or "won't arrive: no courier took the job".

## The smoke test

In Live mode, the smoke-test button sends one real order through the deployed system from start to finish. In Demo mode it plays a pretend run. Either way the test order is easy to pick out:

- New demo traffic pauses, so the test delivery has the village to itself.
- Its courier rides inside a pulsing violet ring under a "🧪 Test delivery" flag.
- Its row in Orders in flight is outlined in violet and labelled "🧪 test".
- The step list ticks off as it goes. A failed step adds "💥 The test delivery failed while …" to the alerts.
