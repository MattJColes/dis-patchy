import { describe, expect, it } from "vitest";
import { serviceLabelPositions } from "./Cloud";

describe("compact cloud labels", () => {
  it("leaves a clear label attached directly to its icon", () => {
    expect(serviceLabelPositions([{ x: 40, y: 80, width: 70, height: 20 }], 320, 568)).toEqual([{ x: 0, y: 0 }]);
  });

  it("accepts DOM rectangle dimensions inherited from a prototype", () => {
    const rectangle = Object.create({ x: 40, y: 80, width: 70, height: 20 });
    const offsets = serviceLabelPositions([rectangle, rectangle], 320, 568);
    expect(offsets[0]).toEqual({ x: 0, y: 0 });
    expect(Math.abs(offsets[1].x) >= 73 || Math.abs(offsets[1].y) >= 23).toBe(true);
  });

  it("separates seven crowded labels while keeping them within the screen and away from the HUD", () => {
    const labels = Array.from({ length: 7 }, (_, index) => ({ x: 130 + index * 4, y: 180 + index * 2, width: 80, height: 20 }));
    const offsets = serviceLabelPositions(labels, 320, 568, [{ x: 0, y: 0, width: 320, height: 150 }]);
    const placed = labels.map((label, index) => ({ ...label, x: label.x + offsets[index].x, y: label.y + offsets[index].y }));
    for (const [index, box] of placed.entries()) {
      expect(box.x).toBeGreaterThanOrEqual(8);
      expect(box.x + box.width).toBeLessThanOrEqual(312);
      expect(box.y).toBeGreaterThanOrEqual(153);
      for (const other of placed.slice(index + 1)) {
        expect(box.x + box.width <= other.x || box.x >= other.x + other.width || box.y + box.height <= other.y || box.y >= other.y + other.height).toBe(true);
      }
    }
  });
});
