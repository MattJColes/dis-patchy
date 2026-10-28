import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { startSmokeRun } from "../live/client";
import { playSmokeRun, smokeSteps } from "../live/demo";
import { useLive } from "../live/store";

function Icon({ status }: { status?: "running" | "passed" | "failed" }) {
  if (status === "running") return <span className="spinner" aria-label="running" />;
  if (status === "passed")
    return (
      <svg viewBox="0 0 16 16" className="icon passed" aria-label="passed">
        <motion.path d="M3 8.5l3 3 7-7" fill="none" strokeWidth="2" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35 }} />
      </svg>
    );
  if (status === "failed")
    return (
      <svg viewBox="0 0 16 16" className="icon failed" aria-label="failed">
        <motion.path d="M4 4l8 8M12 4l-8 8" fill="none" strokeWidth="2" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} />
      </svg>
    );
  return <span className="waiting" aria-label="pending" />;
}

export function SmokePanel() {
  const mode = useLive((s) => s.mode);
  const smoke = useLive((s) => s.smoke);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();

  const running = starting || (smoke !== undefined && !smoke.done);
  const passed = smoke?.steps.filter((s) => s.status === "passed").length ?? 0;
  const failed = smoke?.steps.find((s) => s.status === "failed");

  async function run() {
    setError(undefined);
    if (mode === "demo") return playSmokeRun();
    setStarting(true);
    try {
      const runId = await startSmokeRun();
      useLive.getState().setSmoke({ runId, steps: [], done: false });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className="panel smoke" aria-label="Smoke test">
      <h2>Smoke test</h2>
      <p className="hint">
        {mode === "demo"
          ? "Plays a pretend run through the scene."
          : "Walks one real order from placement to delivery against the deployed APIs."}
      </p>
      <motion.button className={`run ${running ? "busy" : ""}`} onClick={run} disabled={running} whileTap={{ scale: 0.97 }} layout>
        <motion.span className="bar" animate={{ width: `${(passed / smokeSteps.length) * 100}%` }} transition={{ type: "spring", stiffness: 90, damping: 18 }} />
        <span className="label">{running ? `Running… ${passed}/${smokeSteps.length}` : smoke?.done ? "Run again" : "Run smoke test"}</span>
      </motion.button>
      {error && <p className="error">{error}</p>}
      <AnimatePresence>
        {smoke && (
          <motion.ol className="steps" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            {smokeSteps.map((name, i) => {
              const step = smoke.steps.find((s) => s.index === i);
              return (
                <motion.li key={name} className={step?.status ?? "pending"} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}>
                  <Icon status={step?.status} />
                  <div>
                    <span>{name}</span>
                    {step?.detail && step.status === "failed" && <small>{step.detail}</small>}
                  </div>
                </motion.li>
              );
            })}
          </motion.ol>
        )}
      </AnimatePresence>
      {smoke?.done && (
        <motion.p className={`verdict ${failed ? "bad" : "good"}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          {failed ? `Failed at “${failed.step}”` : "Passed: the order is delivered and billed"}
        </motion.p>
      )}
    </section>
  );
}
