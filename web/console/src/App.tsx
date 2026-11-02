import { AnimatePresence } from "motion/react";
import { useEffect, useState } from "react";
import { SignIn } from "./auth/SignIn";
import { Alerts } from "./hud/Alerts";
import { EventFeed } from "./hud/EventFeed";
import { TopBar } from "./hud/TopBar";
import { VillageDesk } from "./hud/VillageDesk";
import { connectLive, disconnectLive, idToken, loadConfig, signOut } from "./live/client";
import { startDemo, stopDemo } from "./live/demo";
import { useLive, type Mode } from "./live/store";
import { Scene } from "./scene/Scene";

export function App() {
  const mode = useLive((s) => s.mode);
  const setMode = useLive((s) => s.setMode);
  const [liveAvailable, setLiveAvailable] = useState(false);
  const [email, setEmail] = useState<string>();
  const [signingIn, setSigningIn] = useState(false);
  const [notice, setNotice] = useState<string>();

  // Live mode needs a signed-in ops user; anything else stays on the demo.
  async function enterLive() {
    const auth = await idToken();
    if (!auth) return setSigningIn(true);
    setEmail(auth.email);
    if (!auth.groups.includes("ops")) return setNotice(`${auth.email} isn't in the ops group, so live mode is unavailable.`);
    setNotice(undefined);
    setMode("live");
  }

  useEffect(() => {
    loadConfig().then(async (config) => {
      if (!config) return;
      setLiveAvailable(true);
      if (await idToken()) enterLive();
    });
  }, []);

  useEffect(() => {
    if (mode === "demo") {
      disconnectLive();
      startDemo();
      return stopDemo;
    }
    connectLive();
    return disconnectLive;
  }, [mode]);

  function chooseMode(m: Mode) {
    if (m === "demo") setMode("demo");
    else enterLive();
  }

  return (
    <>
      <Scene />
      <div className="hud">
        <TopBar
          email={email}
          liveAvailable={liveAvailable}
          onMode={chooseMode}
          onSignOut={async () => {
            await signOut();
            setEmail(undefined);
            setMode("demo");
          }}
        />
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        <Alerts />
        <EventFeed />
        <VillageDesk />
      </div>
      <AnimatePresence>
        {signingIn && (
          <SignIn
            onCancel={() => setSigningIn(false)}
            onDone={() => {
              setSigningIn(false);
              enterLive();
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
