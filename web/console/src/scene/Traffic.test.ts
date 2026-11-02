import { Group, OrthographicCamera, Scene } from "three";
import { describe, expect, it } from "vitest";
import { countVisibleCars } from "./Traffic";

const car = (x = 0, y = 0, z = 0) => {
  const group = new Group();
  group.userData.trafficCar = true;
  group.position.set(x, y, z);
  return group;
};

const camera = () => {
  const view = new OrthographicCamera(-2, 2, 2, -2, 0.1, 20);
  view.position.z = 10;
  return view;
};

describe("visible traffic", () => {
  it("counts tagged car roots in view, including a queue under transformed parents", () => {
    const scene = new Scene();
    const queue = new Group();
    queue.position.x = 2;
    queue.add(car(-1), car(1));
    scene.add(car(), queue, new Group());
    expect(countVisibleCars(scene, camera())).toBe(2);
    queue.position.x = 10;
    expect(countVisibleCars(scene, camera())).toBe(1);
  });

  it("excludes cars outside horizontal, vertical and depth clipping bounds", () => {
    const scene = new Scene();
    scene.add(car(3), car(0, 3), car(0, 0, 11), car(0, 0, -11), car());
    expect(countVisibleCars(scene, camera())).toBe(1);
  });

  it("excludes hidden cars and cars beneath a hidden parent", () => {
    const scene = new Scene();
    const hidden = car();
    hidden.visible = false;
    const queue = new Group();
    queue.visible = false;
    queue.add(car());
    scene.add(hidden, queue, car());
    expect(countVisibleCars(scene, camera())).toBe(1);
  });
});
