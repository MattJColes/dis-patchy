import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { branch, bridges, fieldIsDry, LANE_OFFSET, river, roadPose, rollingHeight, routes, streets, townRoad } from "./paths";

describe("vehicle lane placement", () => {
  it("starts every dense traffic car on its lane, away from the scene origin", () => {
    const lanes = [streets.high, townRoad, streets.orchard, streets.high, townRoad, streets.depot];
    for (let index = 0; index < 20; index++) {
      const curve = lanes[index % lanes.length];
      const progress = ((index * 0.37) % 1) * (curve === townRoad ? 0.12 : 1);
      const side = (index % 2 ? -1 : 1) * LANE_OFFSET;
      const { position } = roadPose(curve, progress, side);
      expect(position.distanceTo(curve.getPointAt(progress))).toBeCloseTo(LANE_OFFSET);
      expect(position.length()).toBeGreaterThan(1);
    }
  });

  it("starts couriers at the depot lane and keeps curved jam queues on the same route", () => {
    for (const { curve } of Object.values(routes)) {
      expect(roadPose(curve, 0).position.distanceTo(streets.depot.points[0])).toBeCloseTo(0);
      for (const progress of [0.15, 0.3, 0.7]) {
        for (const behind of [1.7, 3.5, 5.3]) {
          const queuedAt = Math.max(0, progress - behind / curve.getLength());
          const { position } = roadPose(curve, queuedAt, LANE_OFFSET);
          expect(position.distanceTo(curve.getPointAt(queuedAt))).toBeCloseTo(LANE_OFFSET);
        }
      }
    }
  });

  it("clears both bridge parapets in both directions, including the ends of a car", () => {
    for (const { street, at } of bridges) {
      const centre = street.getPointAt(at);
      const heading = roadPose(street, at).angle;
      const inside = 0.77 * (street === streets.high ? 1.15 : 1.1);
      for (const along of [-1.2, -0.6, 0, 0.6, 1.2]) {
        for (const side of [-LANE_OFFSET, LANE_OFFSET]) {
          const pose = roadPose(street, at + along / street.getLength(), side);
          for (const x of [-0.48 * 0.8, 0.48 * 0.8]) {
            for (const z of [-0.82 * 0.8, 0.82 * 0.8]) {
              const corner = new Vector3(x, 0, z)
                .applyAxisAngle(new Vector3(0, 1, 0), pose.angle)
                .add(pose.position).sub(centre)
                .applyAxisAngle(new Vector3(0, 1, 0), -heading);
              expect(Math.abs(corner.x)).toBeLessThan(inside);
            }
          }
        }
      }
    }
  });
});

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
