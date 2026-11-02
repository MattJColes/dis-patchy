import { describe, expect, it } from "vitest";
import { Box3, Vector3 } from "three";
import { branch, bridges, COURTYARD_SIZE, courtyardCorners, courtyards, doorAt, doorstep, fieldIsDry, footpaths, frontOf, gardenPath, LANE_OFFSET, NEIGHBOUR, river, riverbankDetails, roadPose, rollingHeight, routes, streets, townRoad, TURN } from "./paths";

function distanceToCourtyard(point: Vector3, garden: typeof courtyards[number]) {
  const local = point.clone().sub(garden.position)
    .applyAxisAngle(new Vector3(0, 1, 0), -garden.rotation).divideScalar(garden.scale);
  return Math.hypot(
    Math.max(0, Math.abs(local.x) - COURTYARD_SIZE[0] / 2),
    Math.max(0, Math.abs(local.z) - COURTYARD_SIZE[1] / 2),
  ) * garden.scale;
}

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
          for (const x of [-0.52 * 0.8, 0.52 * 0.8]) {
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

describe("cottage gardens", () => {
  it("keeps courtyard fences clear of streets and shop footpaths", () => {
    const lanes = [
      { curve: streets.high, width: 0.75 },
      { curve: streets.orchard, width: 0.5 },
      { curve: streets.depot, width: 0.5 },
      { curve: townRoad, width: 0.75 },
      ...footpaths.map((curve) => ({ curve, width: 0.38 })),
    ];
    for (const garden of courtyards)
      for (const { curve, width } of lanes)
        for (const point of curve.getSpacedPoints(500))
          expect(distanceToCourtyard(point, garden), `${garden.house} fence at ${point.toArray()}`).toBeGreaterThan(width + 0.08 * garden.scale);
  });

  it("keeps courtyard fences outside both river banks", () => {
    for (const garden of courtyards)
      for (const [water, bank] of [[river, 1.4], [branch, 1]] as const)
        for (const point of water.getSpacedPoints(600))
          expect(distanceToCourtyard(point, garden), `${garden.house} bank at ${point.toArray()}`).toBeGreaterThan(bank + 0.08 * garden.scale);
  });

  it("gives each courtyard a separate footprint", () => {
    expect(courtyardCorners).toHaveLength(courtyards.length * 4);
    const footprints = courtyards.map((_, index) =>
      new Box3().setFromPoints(courtyardCorners.slice(index * 4, index * 4 + 4)),
    );
    expect(footprints[0].intersectsBox(footprints[1])).toBe(false);
  });
});

describe("rotated cottage arrivals", () => {
  it("ends each Orchard Row delivery at its cottage doorstep", () => {
    for (const house of ["customer2", "customer3"] as const)
      expect(routes[house].curve.getPointAt(1).distanceTo(doorstep(house))).toBeCloseTo(0);
  });

  it("keeps residents stepping straight out along the rotated door direction", () => {
    for (const house of ["customer2", "customer3"] as const) {
      const inside = frontOf(house, doorAt(house) + 0.15);
      const outside = frontOf(house, doorAt(house) + 1);
      const exit = outside.sub(inside);
      const normal = new Vector3(Math.sin(TURN[house]), 0, Math.cos(TURN[house]));
      expect(exit.length()).toBeCloseTo(0.85);
      expect(exit.normalize().distanceTo(normal)).toBeCloseTo(0);
    }
  });

  it("keeps the wrong-address detour connected to Orchard Row and the neighbour door", () => {
    const start = gardenPath.getPointAt(0);
    expect(Math.min(...streets.orchard.points.map((point) => point.distanceTo(start)))).toBeCloseTo(0);
    const door = new Vector3(0.3 * 0.7, 0, 1.14 * 0.7)
      .applyAxisAngle(new Vector3(0, 1, 0), TURN.neighbour).add(new Vector3(...NEIGHBOUR));
    expect(gardenPath.getPointAt(1).distanceTo(door)).toBeLessThan(0.2);
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

describe("riverbank decorations", () => {
  it("leaves the bridge approaches and shop footpaths clear", () => {
    const lanes = [...Object.values(streets), townRoad, ...footpaths];
    expect(riverbankDetails.length).toBeGreaterThan(0);
    for (const { position } of riverbankDetails)
      for (const lane of lanes)
        for (const point of lane.getSpacedPoints(600))
          expect(position.distanceTo(point)).toBeGreaterThan(1.1);
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
