// Live mode: Cognito sign-in (SRP, the only flow the app client allows) and
// the AppSync Events subscription the relays publish to.
import { Amplify } from "aws-amplify";
import { fetchAuthSession, getCurrentUser, signOut } from "aws-amplify/auth";
import { events } from "aws-amplify/data";
import { eventKinds, type LiveEvent } from "../topology";
import { useLive } from "./store";
import { isFleet, type Scenario } from "./assets";

export interface Config {
  region: string;
  userPoolId: string;
  clientId: string;
  eventsEndpoint: string;
}

/** config.json is written at deploy time; without it only demo mode works. */
export async function loadConfig(): Promise<Config | undefined> {
  try {
    const res = await fetch("/config.json", { cache: "no-store" });
    if (!res.ok) return undefined;
    const config = (await res.json()) as Config;
    Amplify.configure({
      Auth: { Cognito: { userPoolId: config.userPoolId, userPoolClientId: config.clientId } },
      API: { Events: { endpoint: config.eventsEndpoint, region: config.region, defaultAuthMode: "userPool" } },
    });
    return config;
  } catch {
    return undefined;
  }
}

export async function idToken(): Promise<{ token: string; groups: string[]; email: string } | undefined> {
  try {
    await getCurrentUser();
    const { tokens } = await fetchAuthSession();
    if (!tokens?.idToken) return undefined;
    const payload = tokens.idToken.payload;
    return {
      token: tokens.idToken.toString(),
      groups: (payload["cognito:groups"] as string[] | undefined) ?? [],
      email: String(payload.email ?? ""),
    };
  } catch {
    return undefined;
  }
}

export { signOut };

const CHANNEL = "/live/system";

export function parse(data: unknown): LiveEvent | undefined {
  const raw = (data as { event?: unknown })?.event ?? data;
  try {
    const event = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!event || !eventKinds.includes(event.kind) || typeof event.at !== "string" ||
        !event.detail || typeof event.detail !== "object" || Array.isArray(event.detail)) return undefined;
    return event as LiveEvent;
  } catch {
    return undefined;
  }
}

let close: (() => void) | undefined;

export async function connectLive() {
  disconnectLive();
  const { setConnection, ingest } = useLive.getState();
  setConnection("connecting");
  try {
    const channel = await events.connect(CHANNEL);
    const sub = channel.subscribe({
      next: (data) => {
        const event = parse(data);
        if (event?.kind) ingest(event);
      },
      error: () => setConnection("error"),
    });
    setConnection("live");
    close = () => {
      sub.unsubscribe();
      channel.close();
    };
  } catch {
    setConnection("error");
  }
}

export function disconnectLive() {
  close?.();
  close = undefined;
  useLive.getState().setConnection("offline");
}

/** Starts a real smoke run through CloudFront's same-origin /api behaviour. */
export async function startSmokeRun(scenario: Scenario = "smoke"): Promise<string> {
  const auth = await idToken();
  if (!auth) throw new Error("Sign in first");
  const res = await fetch(scenario === "smoke" ? "/api/smoke-runs" : "/api/scenario-runs", {
    method: "POST", headers: { Authorization: auth.token, "Content-Type": "application/json" },
    body: JSON.stringify({ scenario }), signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
  if (!res.ok) throw new Error(body.error ?? `Smoke run failed to start (${res.status})`);
  if (!body.runId) throw new Error("Test run response has no run ID");
  return body.runId;
}

export async function refreshFleet() {
  const auth = await idToken();
  if (!auth) throw new Error("Sign in first");
  const res = await fetch("/api/assets", { headers: { Authorization: auth.token }, signal: AbortSignal.timeout(15_000) });
  const body: unknown = await res.json();
  if (!res.ok) throw new Error(`Fleet could not be read (${res.status})`);
  if (!isFleet(body)) throw new Error("Fleet response is invalid");
  if (useLive.getState().mode === "live") useLive.getState().setFleet(body);
}
