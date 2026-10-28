import { AnimatePresence, motion } from "motion/react";
import { stages, useLive } from "../live/store";

export function OrderTimeline() {
  const orders = useLive((s) => s.orders);
  const rows = Object.values(orders)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 4);

  return (
    <section className="panel timeline" aria-label="Orders in flight">
      <h2>Orders in flight</h2>
      {rows.length === 0 && <p className="empty">Waiting for the first order…</p>}
      <ul>
        <AnimatePresence initial={false}>
          {rows.map((o) => {
            const failed = o.stage === "Failed";
            const reached = failed ? 1 : stages.indexOf(o.stage as (typeof stages)[number]);
            return (
              <motion.li
                key={o.id}
                layout
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
                className={failed ? "failed" : o.stage === "Billed" ? "complete" : ""}
              >
                <code>{o.id.slice(0, 8)}</code>
                <div className="track">
                  <motion.div
                    className="fill"
                    initial={false}
                    animate={{ width: `${(reached / (stages.length - 1)) * 100}%` }}
                    transition={{ type: "spring", stiffness: 120, damping: 20 }}
                  />
                  {stages.map((s, i) => (
                    <motion.span
                      key={s}
                      className={`node ${i <= reached ? "on" : ""}`}
                      style={{ left: `${(i / (stages.length - 1)) * 100}%` }}
                      animate={i === reached && !failed ? { scale: [1, 1.5, 1] } : { scale: 1 }}
                      transition={{ duration: 0.5 }}
                    />
                  ))}
                </div>
                <span className="stage">{failed ? "Unassignable" : o.stage}</span>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </section>
  );
}
