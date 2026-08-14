import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { conditionOf, isCoord, roundCoord, type Reading } from "@/lib/weather";

/**
 * Current conditions for a pair of coordinates.
 *
 * Proxied through the portal rather than called from the browser, for the same
 * reason scans are served through `/api/file` rather than from a bucket URL: the
 * page talks to this origin and nothing else. It also means one call to
 * Open-Meteo covers every tab and every operator, instead of one per browser.
 *
 * Coordinates come from the browser's own geolocation, which is the only thing
 * that knows where the machine is. They are rounded before they are used or
 * cached, and they are never written to the database — the weather is decoration
 * and does not warrant keeping a record of where somebody was sitting.
 *
 * Behind the password gate like every other route here. The weather is not
 * secret, but an open endpoint that forwards arbitrary coordinates to a third
 * party on request is a small favour to do the internet for nothing.
 */

/** Open-Meteo: no key, no signup. Free for non-commercial use. */
const ENDPOINT = "https://api.open-meteo.com/v1/forecast";

/**
 * Fifteen minutes. Weather does not move faster than that, and it means a header
 * on twenty page loads is one call rather than twenty.
 */
const CACHE_SECONDS = 900;

interface OpenMeteoResponse {
  timezone?: string;
  current?: { temperature_2m?: number; weather_code?: number };
}

export async function GET(request: Request) {
  if (!(await isAuthenticated())) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  if (!isCoord(lat, lon)) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const url = new URL(ENDPOINT);
  url.searchParams.set("latitude", String(roundCoord(lat)));
  url.searchParams.set("longitude", String(roundCoord(lon)));
  url.searchParams.set("current", "temperature_2m,weather_code");
  // Resolves the zone for those coordinates, which is the cheapest way to give
  // the operator something recognisable to check the location against.
  url.searchParams.set("timezone", "auto");

  try {
    const res = await fetch(url, {
      // Next's data cache, keyed on the rounded URL — so the same desk asking
      // again inside the window costs nothing.
      next: { revalidate: CACHE_SECONDS },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return new NextResponse("Upstream error", { status: 502 });

    const data = (await res.json()) as OpenMeteoResponse;
    const temp = data.current?.temperature_2m;
    const code = data.current?.weather_code;
    if (typeof temp !== "number" || typeof code !== "number") {
      return new NextResponse("Upstream error", { status: 502 });
    }

    const { condition, label } = conditionOf(code);
    const reading: Reading = {
      tempC: Math.round(temp),
      condition,
      label,
      timezone: data.timezone ?? "",
    };

    return NextResponse.json(reading, {
      // private: this is behind a password, so no shared cache should hold it.
      headers: { "Cache-Control": `private, max-age=${CACHE_SECONDS}` },
    });
  } catch {
    // Offline, blocked, or Open-Meteo having a bad afternoon. The header shows
    // nothing at all in that case, which is the right amount of noise to make
    // about a temperature.
    return new NextResponse("Unavailable", { status: 503 });
  }
}
