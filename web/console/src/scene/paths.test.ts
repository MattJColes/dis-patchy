import { describe, expect, it } from "vitest";
import { branch, fieldIsDry, river, rollingHeight } from "./paths";

describe("vineyard clearance", () => {
  it("excludes plots crossed by either river branch", () => {
    for (const water of [river, branch]) {
      const point = water.getPointAt(0.6);
      expect(fieldIsDry(point.x, point.z, 15, 8.6)).toBe(false);
    }
  });

  it("keeps vines away from the river bank too", () => {
    const point = river.getPointAt(0.6);
    expect(fieldIsDry(point.x + 6, point.z, 10, 8.6)).toBe(false);
  });

  it("allows a field well clear of the water", () => {
    expect(fieldIsDry(-70, -40, 15, 8.6)).toBe(true);
  });
});

describe("rolling scenery", () => {
  it("keeps the village and roads flat", () => {
    expect(rollingHeight(-7.2, -5.8)).toBe(0);
    expect(rollingHeight(1.5, 10.3)).toBe(0);
  });

  it("keeps the river valley at water level", () => {
    const point = river.getPointAt(0.8);
    expect(rollingHeight(point.x, point.z)).toBe(0);
  });

  it("adds gentle variation to distant dry fields", () => {
    const left = rollingHeight(-70, -40);
    const right = rollingHeight(70, -40);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThanOrEqual(1.5);
    expect(right).not.toBeCloseTo(left);
  });
});
