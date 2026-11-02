// The village's time of day and weather. Demo mode runs a fast day with
// made-up weather that really slows its couriers; live mode follows the
// viewer's clock under a clear sky, because the console has no weather data
// and mustn't suggest real deliveries are slower than they are.

export type Weather = "clear" | "rain" | "storm";

export interface World {
  hour: number; // 0–24
  daylight: number; // 0 at night, 1 at noon
  weather: Weather;
  peak: boolean;
  slow: number; // how much longer a demo delivery takes than usual
}

export const DAY_SECONDS = 120; // one demo day
const WEATHER_SECONDS = 20;
const forecast: Weather[] = ["clear", "clear", "rain", "clear", "storm", "rain", "clear", "clear"];

export const isPeak = (hour: number) => (hour >= 11.5 && hour < 13.5) || (hour >= 17 && hour < 19.5);

export function worldAt(seconds: number, live: boolean, now = new Date()): World {
  const hour = live ? now.getHours() + now.getMinutes() / 60 : ((seconds / DAY_SECONDS) * 24 + 7) % 24; // demo days start at 7am
  const daylight = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI)) ** 0.6;
  const weather = live ? "clear" : forecast[Math.floor(seconds / WEATHER_SECONDS) % forecast.length];
  const peak = isPeak(hour);
  const slow = (weather === "storm" ? 2 : weather === "rain" ? 1.4 : 1) * (peak ? 1.5 : 1);
  return { hour, daylight, weather, peak, slow };
}
