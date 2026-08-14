/**
 * What the sky is doing, in the portal's own terms.
 *
 * Open-Meteo answers with a WMO weather code — a standard list of about thirty
 * numbers, from 0 (clear) to 99 (thunderstorm with heavy hail). Thirty is far
 * more than a glyph in a header can say, so they collapse to seven conditions
 * here, and this file is the only place that knows the mapping. The API route
 * and the header both read it, so the picture and the words can never disagree.
 *
 * No fetching here, and nothing about the network: this is a lookup table, which
 * is why it can be imported into the browser as safely as into the server.
 */

/** The seven the portal draws. */
export type Condition = "clear" | "partly" | "cloud" | "fog" | "rain" | "snow" | "storm";

export interface Reading {
  /** Degrees Celsius, already rounded — nobody needs a tenth of a degree. */
  tempC: number;
  condition: Condition;
  /** "Overcast", "Light rain" — for the tooltip, since the glyph is the label. */
  label: string;
  /** The zone Open-Meteo resolved for those coordinates, e.g. "Asia/Karachi". */
  timezone: string;
}

/**
 * WMO code → condition and words.
 *
 * Grouped by what a person looking out of a window would say, not by the
 * standard's own divisions: it separates drizzle from rain from showers across
 * nine codes, and all nine are "it is raining" to somebody deciding whether to
 * walk to the café. Freezing rain is kept with rain rather than snow, because it
 * falls as water and that is what matters on the way out.
 */
const CODES: Record<number, { condition: Condition; label: string }> = {
  0: { condition: "clear", label: "Clear" },
  1: { condition: "clear", label: "Mainly clear" },
  2: { condition: "partly", label: "Partly cloudy" },
  3: { condition: "cloud", label: "Overcast" },

  45: { condition: "fog", label: "Fog" },
  48: { condition: "fog", label: "Freezing fog" },

  51: { condition: "rain", label: "Light drizzle" },
  53: { condition: "rain", label: "Drizzle" },
  55: { condition: "rain", label: "Heavy drizzle" },
  56: { condition: "rain", label: "Freezing drizzle" },
  57: { condition: "rain", label: "Freezing drizzle" },

  61: { condition: "rain", label: "Light rain" },
  63: { condition: "rain", label: "Rain" },
  65: { condition: "rain", label: "Heavy rain" },
  66: { condition: "rain", label: "Freezing rain" },
  67: { condition: "rain", label: "Freezing rain" },

  71: { condition: "snow", label: "Light snow" },
  73: { condition: "snow", label: "Snow" },
  75: { condition: "snow", label: "Heavy snow" },
  77: { condition: "snow", label: "Snow grains" },

  80: { condition: "rain", label: "Light showers" },
  81: { condition: "rain", label: "Showers" },
  82: { condition: "rain", label: "Heavy showers" },

  85: { condition: "snow", label: "Snow showers" },
  86: { condition: "snow", label: "Heavy snow showers" },

  95: { condition: "storm", label: "Thunderstorm" },
  96: { condition: "storm", label: "Thunderstorm with hail" },
  99: { condition: "storm", label: "Thunderstorm with hail" },
};

/**
 * An unrecognised code falls back to cloud rather than to nothing. The list above
 * is complete as the standard stands, but a provider adding one should cost a
 * slightly wrong glyph, not a blank space where the weather was.
 */
export function conditionOf(code: number): { condition: Condition; label: string } {
  return CODES[code] ?? { condition: "cloud", label: "Cloudy" };
}

/**
 * Coordinates, rounded to two decimals — a little over a kilometre.
 *
 * Rounding does two jobs. Weather does not vary within a kilometre, so it costs
 * nothing; and it means the exact position of somebody's desk is never what gets
 * sent to a server, written into a cache key or left in a log. Precision nobody
 * needs is precision not worth keeping.
 */
export function roundCoord(value: number): number {
  return Math.round(value * 100) / 100;
}

export function isCoord(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
  );
}
