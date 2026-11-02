import { describe, expect, it } from "vitest";
import { DAY_SECONDS, isPeak, worldAt } from "./world";

const at = (hour: number) => (((hour - 7 + 24) % 24) / 24) * DAY_SECONDS;

describe("worldAt", () => {
  it("starts the demo day at 7am", () => {
    expect(worldAt(0, false).hour).toBe(7);
  });

  it("is dark at midnight", () => {
    expect(worldAt(at(0), false).daylight).toBe(0);
  });

  it("treats lunchtime as a peak", () => {
    expect(isPeak(12.5)).toBe(true);
  });

  it("slows a storm at peak hour to three times as long", () => {
    // The fifth weather spell of the day is a storm.
    const w = worldAt(85, false);
    expect(w.weather).toBe("storm");
    expect(w.slow).toBe(w.peak ? 3 : 2);
  });

  it("never invents weather in live mode", () => {
    expect(worldAt(85, true).weather).toBe("clear");
  });

  it("holds a selected scene time and weather while the performance clock advances", () => {
    for (const seconds of [0, 60, 160]) {
      const world = worldAt(seconds, false, new Date(), { hour: 0, weather: "rain" });
      expect(world.hour).toBe(0);
      expect(world.daylight).toBe(0);
      expect(world.weather).toBe("rain");
    }
  });

  it("returns to the local clock and clear sky when live appearance overrides are reset", () => {
    const now = new Date(2026, 10, 2, 12, 30);
    expect(worldAt(85, true, now, { hour: 0, weather: "storm" }).hour).toBe(0);
    expect(worldAt(85, true, now).hour).toBe(12.5);
    expect(worldAt(85, true, now).weather).toBe("clear");
  });
});
