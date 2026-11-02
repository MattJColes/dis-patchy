import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { refreshFleet, startSmokeRun } from "../live/client";
import { playSmokeRun, smokeSteps } from "../live/demo";
import { useLive } from "../live/store";
import { scenarios, type Scenario } from "../live/assets";

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
  const [fleetError, setFleetError] = useState<string>();
  const [scenario, setScenario] = useState<Scenario>("smoke");
  const connection = useLive((s) => s.connection);
  const fleet = useLive((s) => s.fleet);
  useEffect(() => {
    if (mode === "live" && connection === "live") {
      setFleetError(undefined);
      void refreshFleet().catch((e: Error) => setFleetError(e.message));
    }
  }, [mode, connection, smoke?.done]);

  const running = starting || (smoke !== undefined && !smoke.done);
  const passed = smoke?.steps.filter((s) => s.status === "passed").length ?? 0;
  const failed = smoke?.steps.find((s) => s.status === "failed");
  const total = smoke?.steps[0]?.total ?? (scenario === "smoke" || mode === "demo" ? smokeSteps.length : 4);
  const names = smoke?.scenario && smoke.scenario !== "smoke"
    ? Array.from({ length: total }, (_, i) => smoke.steps.find((s) => s.index === i)?.step ?? "Waiting")
    : smokeSteps;
  const selected = scenarios.find((s) => s.id === scenario)!;

  async function run() {
    setError(undefined);
    if (mode === "demo") return playSmokeRun();
    setStarting(true);
    try {
      const runId = await startSmokeRun(scenario);
      const current = useLive.getState().smoke;
      if (current?.runId !== runId) useLive.getState().setSmoke({ runId, scenario, steps: [], done: false });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className="panel smoke" aria-label="Smoke test">
      <h2>Test a little parcel</h2>
      <p className="hint">
        {mode === "demo"
          ? "Follow a demo parcel from the shop to the doorstep. Village deliveries pause while it makes its way."
          : `${selected.hint} Sandbox run: creates orders and sends email.`}
      </p>
      {mode === "live" && (
        <>
          <label className="scenario-select">
            Scenario
            <select value={scenario} onChange={(e) => setScenario(e.target.value as Scenario)} disabled={running}>
              {scenarios.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <p className="fleet-status" aria-live="polite">
            {fleet ? fleet.drivers.length === 0 ? "Test fleet not prepared yet."
              : fleet.drivers.map((d) => `${d.name} · ${d.vehicleId} · ${d.status.toLowerCase()}`).join(" / ")
              : "Reading the test fleet…"}
          </p>
          {fleetError && <p className="error">{fleetError}</p>}
        </>
      )}
      <motion.button className={`run ${running ? "busy" : ""}`} onClick={run} disabled={running} whileTap={{ scale: 0.97 }} layout>
        <motion.span className="bar" animate={{ width: `${(passed / total) * 100}%` }} transition={{ type: "spring", stiffness: 90, damping: 18 }} />
        <span className="label">{running ? `Running… ${passed}/${total}` : mode === "live" && scenario !== "smoke" ? "Run scenario" : "Send test parcel"}</span>
      </motion.button>
      {error && <p className="error">{error}</p>}
      <AnimatePresence>
        {/* A passed run folds its steps away to keep the panel short; a failed one keeps them to show where. */}
        {smoke && !(smoke.done && !failed && (!smoke.scenario || smoke.scenario === "smoke")) && (
          <motion.ol className="steps" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            {names.map((name, i) => {
              const step = smoke.steps.find((s) => s.index === i);
              return (
                <motion.li key={i} className={step?.status ?? "pending"} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}>
                  <Icon status={step?.status} />
                  <div>
                    <span>{name}</span>
                    {step?.detail && (step.status === "failed" || smoke.scenario !== "smoke") && <small>{step.detail}</small>}
                  </div>
                </motion.li>
              );
            })}
          </motion.ol>
        )}
      </AnimatePresence>
      {smoke?.done && (
        <motion.p className={`verdict ${failed ? "bad" : "good"}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          {failed ? `Failed at “${failed.step}”` : smoke.scenario && smoke.scenario !== "smoke"
            ? "Scenario finished. Review the observed results." : "Delivered. Billing and emails are confirmed separately."}
        </motion.p>
      )}
    </section>
  );
}
