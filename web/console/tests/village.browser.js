// Run against the local Vite demo with playwright-cli run-code --filename=tests/village.browser.js.
async (page) => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Attempted to synchronously unmount a root"))
      errors.push(message.text());
  });
  const settle = () => page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const camera = () => page.evaluate(async () => {
    const resource = performance.getEntriesByType("resource").find((entry) => entry.name.includes("@react-three_fiber.js"));
    const { _roots } = await import(resource.name);
    const { camera } = _roots.get(document.querySelector("canvas")).store.getState();
    return { zoom: camera.zoom, view: camera.view, position: camera.position.toArray() };
  });
  const closedControls = (selector) => page.locator(selector).evaluate((container) =>
    [...container.querySelectorAll("button, input, select")].every((control) => {
      control.focus();
      return document.activeElement !== control && control.getClientRects().length === 0;
    }));

  await page.goto("http://127.0.0.1:5173/");
  await page.locator(".village-loading").waitFor({ state: "hidden" });
  await page.evaluate(async () => {
    const resources = performance.getEntriesByType("resource");
    // Reuse the app's actual modules, including Vite's current HMR timestamps.
    window.villageTestStore = await import(resources.find((entry) => entry.name.includes("/src/live/store.ts")).name);
    const { stopDemo } = await import(resources.find((entry) => entry.name.includes("/src/live/demo.ts")).name);
    const { useLive } = window.villageTestStore;
    if (useLive.getState().mode !== "demo") throw new Error("Browser self-check requires Demo mode");
    stopDemo();
    useLive.setState({ orders: {}, packets: [], arrivals: [], drivers: {}, smoke: undefined, demoOrders: 0, traffic: 0 });
    useLive.getState().setSceneHour(10);
    useLive.getState().setSceneWeather("clear");
    for (const [kind, detail] of [
      ["OrderPlaced", { orderId: "layout-incident", shopId: "test-shop" }],
      ["WorkflowStatus", { orderId: "layout-incident", status: "FAILED" }],
    ]) useLive.getState().ingest({ kind, detail, at: new Date().toISOString() });
  });
  const layouts = [];
  for (const [width, height] of [[320, 568], [390, 844], [834, 1194], [1440, 1000], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await settle();
    const compact = width <= 1100;
    const desk = page.locator(".desk-toggle");
    if (compact) {
      assert(await closedControls(".desk-content"), `Hidden desk controls remain focusable at ${width}`);
      const before = await camera();
      const bounds = await desk.boundingBox();
      assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height,
        `Desk or incident summary escapes ${width}×${height}`);
      assert(await page.locator(".desk-incidents").isVisible(), "Collapsed incident count is missing");
      await desk.focus();
      await desk.press("Enter");
      await page.locator(".desk-content").waitFor({ state: "visible" });
      await settle();
      assert(JSON.stringify(await camera()) === JSON.stringify(before), `Opening the desk reframes ${width}×${height}`);
      assert(JSON.stringify(await desk.boundingBox()) === JSON.stringify(bounds), "Opening the desk moves its summary");
    }
    assert(await page.getByRole("button", { name: "Send test parcel", exact: true }).isVisible(), "Parcel test is unreachable");
    assert(await page.getByRole("slider", { name: /Deliveries in progress/ }).isVisible(), "Delivery slider is unreachable");
    assert(await page.getByRole("slider", { name: /Other traffic/ }).isVisible(), "Traffic slider is unreachable");
    if (compact) {
      assert(await page.getByRole("region", { name: "Cloud services" }).isVisible(), "Service names are unavailable");
      await desk.focus();
      await desk.press("Enter");
      assert(await closedControls(".desk-content"), "Closing the desk leaves controls in the tab order");
      const sky = page.locator(".sky-summary");
      assert(await closedControls(".sky-dials"), "Closed sky controls remain focusable");
      const before = await camera();
      await sky.focus();
      await sky.press("Space");
      await page.locator(".sky-dials").waitFor({ state: "visible" });
      await settle();
      assert(JSON.stringify(await camera()) === JSON.stringify(before), "Opening the sky picker reframes the scene");
    }
    assert(await page.getByRole("slider", { name: "Scene time", exact: true }).isVisible(), "Time dial is unreachable");
    for (const name of ["Set daytime", "Set nighttime", "Set clear weather", "Set rain weather", "Set storm weather", "Reset scene time", "Reset scene weather"])
      assert(await page.getByRole("button", { name, exact: true }).isVisible(), `${name} is unreachable`);
    if (compact) {
      await page.locator(".sky-summary").focus();
      await page.locator(".sky-summary").press("Space");
      assert(await closedControls(".sky-dials"), "Closing the sky picker leaves controls in the tab order");
    }
    layouts.push(`${width}×${height}`);
  }
  await page.evaluate(() => {
    const { useLive } = window.villageTestStore;
    useLive.setState({ orders: {}, packets: [], arrivals: [], drivers: {}, smoke: undefined });
  });
  await settle();
  const rendering = await page.evaluate(async () => {
    const resource = performance.getEntriesByType("resource").find((entry) => entry.name.includes("@react-three_fiber.js"));
    const { _roots } = await import(resource.name);
    const { scene, gl } = _roots.get(document.querySelector("canvas")).store.getState();
    const routes = [];
    scene.traverse((object) => {
      const material = object.material;
      if (material?.isLineMaterial && ["3766c4", "1aa39a"].includes(material.color.getHexString()))
        routes.push({ color: material.color.getHexString(), opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite });
    });
    return { routes, linked: gl.info.programs.length > 0 && gl.info.programs.every(({ program }) => gl.getContext().getProgramParameter(program, gl.getContext().LINK_STATUS)) };
  });
  assert(rendering.routes.filter((route) => route.color === "3766c4").length === 3, "Blue delivery roads are missing");
  assert(rendering.routes.some((route) => route.color === "1aa39a"), "Teal cloud communications are missing");
  assert(rendering.routes.every((route) => route.opacity === 0.5 && route.transparent && !route.depthWrite), "Route translucency changed");
  assert(rendering.linked, "A rendered shader program failed to link");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".desk-toggle").click();
  assert(await page.evaluate(() => window.villageTestStore.useLive.getState().mode === "demo"), "Test delivery must run in Demo mode");
  await page.getByRole("button", { name: "Send test parcel", exact: true }).click();
  await page.waitForFunction(() => window.villageTestStore.useLive.getState().smoke?.orderId);
  const runId = await page.evaluate(() => window.villageTestStore.useLive.getState().smoke.runId);
  await page.locator(".desk-toggle").click();
  assert((await page.locator(".desk-progress").innerText()).includes("🧪"), "Collapsed test progress is missing");
  for (const [width, height] of [[1440, 1000], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await settle();
    assert(await page.evaluate((id) => window.villageTestStore.useLive.getState().smoke.runId === id, runId),
      "Resize restarted the test delivery");
  }
  await page.locator(".desk-toggle").click();
  assert(await page.getByRole("button", { name: /Running…/ }).isVisible(), "Reopening the desk loses the running test");
  await page.waitForFunction(() => {
    const { smoke, orders } = window.villageTestStore.useLive.getState();
    return smoke?.done && orders[smoke.orderId]?.stage === "Billed";
  }, null, { timeout: 40000 });
  assert((await page.locator(".verdict").innerText()).includes("Delivered"), "Completed demo test verdict is missing");
  assert(errors.length === 0, `Browser errors: ${errors.join("\n")}`);
  return { layouts, routes: rendering.routes.length, shadersLinked: rendering.linked, demoRun: runId, result: "passed" };
}
