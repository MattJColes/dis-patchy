import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useLive } from "../live/store";

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`;
}

export function EventFeed() {
  const feed = useLive((s) => s.feed);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <aside className="panel feed" aria-label="Event feed">
      <h2>
        Event stream <span className="count">{feed.length}</span>
      </h2>
      <ol aria-live="polite">
        <AnimatePresence initial={false}>
          {feed.slice(0, 8).map((item) => (
            <motion.li
              key={item.id}
              layout
              initial={{ opacity: 0, x: 40, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 20, transition: { duration: 0.15 } }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              style={{ ["--c" as string]: item.color }}
            >
              <span className="kind">{item.kind}</span>
              <span className="text">{item.text}</span>
              <time>{ago(now - item.at)}</time>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </aside>
  );
}
