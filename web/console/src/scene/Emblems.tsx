// Little toon models that sit on each stack's cube and say what it does.
import type { ComponentProps } from "react";
import { Toon } from "./toon";

// Each part glows faintly in its own colour, so weather and night never grey the icons out.
const Glow = (props: ComponentProps<typeof Toon>) => <Toon emissive={props.color} glow={0.35} {...props} />;

const WHITE = "#fffaf0";
const DARK = "#2f3542";

/** Orders: a receipt with a folded corner and printed lines. */
function Receipt() {
  return (
    <group rotation={[-0.25, 0, 0]}>
      <Glow color={WHITE}>
        <boxGeometry args={[0.7, 0.9, 0.06]} />
      </Glow>
      {[0.22, 0.06, -0.1, -0.26].map((y, i) => (
        <Glow key={y} position={[-0.04, y, 0.04]} color={i === 0 ? "#f39c34" : "#b9b2a2"} outline={0}>
          <boxGeometry args={[i === 0 ? 0.44 : 0.5, 0.06, 0.02]} />
        </Glow>
      ))}
    </group>
  );
}

/** Dispatch: a signpost with two arrows pointing different ways. */
function Signpost() {
  return (
    <group>
      <Glow position={[0, 0.1, 0]} color="#8c5a3c" outline={0.02}>
        <cylinderGeometry args={[0.05, 0.05, 1, 8]} />
      </Glow>
      {[
        [0.28, 0.42, 0.2, "#3d7fd9"],
        [-0.28, 0.16, -0.25, WHITE],
      ].map(([x, y, r, c]) => (
        <group key={String(x)} position={[x as number, y as number, 0]} rotation={[0, r as number, 0]}>
          <Glow color={c as string} outline={0.02}>
            <boxGeometry args={[0.5, 0.18, 0.06]} />
          </Glow>
          <Glow position={[(x as number) > 0 ? 0.3 : -0.3, 0, 0]} rotation={[0, 0, (x as number) > 0 ? -Math.PI / 2 : Math.PI / 2]} color={c as string} outline={0.02}>
            <coneGeometry args={[0.13, 0.16, 3]} />
          </Glow>
        </group>
      ))}
    </group>
  );
}

/** Tracking: a map pin. */
function Pin() {
  return (
    <group position={[0, 0.15, 0]}>
      <Glow position={[0, 0.32, 0]} color="#e8613a">
        <sphereGeometry args={[0.3, 16, 12]} />
      </Glow>
      <Glow position={[0, -0.05, 0]} rotation={[Math.PI, 0, 0]} color="#e8613a">
        <coneGeometry args={[0.24, 0.5, 16]} />
      </Glow>
      <Glow position={[0, 0.34, 0.24]} color={WHITE} outline={0.015}>
        <sphereGeometry args={[0.11, 12, 10]} />
      </Glow>
    </group>
  );
}

/** Proof: a camera. */
function Camera() {
  return (
    <group>
      <Glow color={DARK}>
        <boxGeometry args={[0.8, 0.5, 0.36]} />
      </Glow>
      <Glow position={[0, 0, 0.22]} rotation={[Math.PI / 2, 0, 0]} color="#9aa0a8" outline={0.02}>
        <cylinderGeometry args={[0.17, 0.2, 0.18, 16]} />
      </Glow>
      <Glow position={[0, 0, 0.32]} rotation={[Math.PI / 2, 0, 0]} color="#5aa7d8" emissive="#5aa7d8" outline={0}>
        <cylinderGeometry args={[0.11, 0.11, 0.02, 16]} />
      </Glow>
      <Glow position={[0.24, 0.3, 0]} color="#3f9e4f" outline={0.015}>
        <boxGeometry args={[0.16, 0.1, 0.14]} />
      </Glow>
    </group>
  );
}

/** Notifications: an envelope with its flap down. */
function Envelope() {
  return (
    <group rotation={[-0.2, 0, 0]}>
      <Glow color={WHITE}>
        <boxGeometry args={[0.9, 0.58, 0.08]} />
      </Glow>
      <Glow position={[0, 0.12, 0.05]} rotation={[0, 0, Math.PI]} scale={[1, 0.62, 1]} color="#d9487a" outline={0.015}>
        <coneGeometry args={[0.52, 0.6, 3]} />
      </Glow>
    </group>
  );
}

/** Billing: a stack of gold coins. */
function Coins() {
  return (
    <group position={[0, -0.15, 0]}>
      {[0, 1, 2, 3].map((i) => (
        <Glow key={i} position={[(i % 2) * 0.05, i * 0.12, 0]} color="#f2c14e" outline={0.02}>
          <cylinderGeometry args={[0.3, 0.3, 0.1, 18]} />
        </Glow>
      ))}
    </group>
  );
}

/** EventBridge: the bus, literally. */
function Bus() {
  return (
    <group>
      <Glow position={[0, 0.05, 0]} color="#f2c14e">
        <boxGeometry args={[1, 0.46, 0.5]} />
      </Glow>
      {[-0.3, 0, 0.3].map((x) => (
        <Glow key={x} position={[x, 0.12, 0.26]} color="#cfe7f5" outline={0.012}>
          <boxGeometry args={[0.2, 0.16, 0.02]} />
        </Glow>
      ))}
      {[-0.3, 0.3].map((x) => (
        <Glow key={x} position={[x, -0.2, 0.2]} rotation={[Math.PI / 2, 0, 0]} color={DARK} outline={0.015}>
          <cylinderGeometry args={[0.1, 0.1, 0.1, 12]} />
        </Glow>
      ))}
    </group>
  );
}

export const emblems: Record<string, () => React.JSX.Element> = {
  orders: Receipt,
  dispatch: Signpost,
  tracking: Pin,
  proof: Camera,
  notifications: Envelope,
  billing: Coins,
  bus: Bus,
};
