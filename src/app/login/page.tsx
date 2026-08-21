import { redirect } from "next/navigation";
import LockMark from "@/components/LockMark";
import PasswordField from "@/components/PasswordField";
import SubmitButton from "@/components/SubmitButton";
import { ThemeToggleCorner } from "@/components/ThemeToggle";
import {
  checkPassword,
  isAuthenticated,
  startSession,
  usingDefaultPassword,
} from "@/lib/auth";

/**
 * The whole authentication system: one password, one cookie.
 * The plan calls for a single operator, so there is nothing to model here.
 *
 * Unlocking always lands on "/" — the company picker, with Food and
 * Expenditure underneath it — rather than wherever the operator happened to
 * be headed when the session expired. One predictable landing spot beats a
 * deep link into a workspace the operator has to reorient inside of.
 */
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  if (await isAuthenticated()) redirect("/");

  async function submit(formData: FormData) {
    "use server";
    const password = String(formData.get("password") ?? "");

    if (!checkPassword(password)) {
      redirect("/login?error=1");
    }
    await startSession();
    redirect("/");
  }

  return (
    <>
      <DriftingSheets />

      <main className="relative z-10 mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-16">
        {/* Reachable before unlocking, on purpose. This is the first screen the
            portal shows and often the only one showing for a while; somebody who
            keeps their machine dark should be able to settle that here rather
            than having to get past the password first. */}
        <ThemeToggleCorner />

        {/* A slow, calm breathing pulse. The sheets behind are texture; this is
            the one thing on the screen that is meant to be looked at moving. */}
        <div
          aria-hidden="true"
          className="lock-breathe mb-5 flex h-14 w-14 items-center justify-center rounded-full"
          style={{ background: "var(--accent-wash)", color: "var(--accent)" }}
        >
          <LockMark className="h-6 w-6" />
        </div>

        <h1 className="text-[22px] font-bold tracking-tight">Company Portal</h1>
        <p className="mt-1.5 text-[14px] text-ink-soft">Enter the portal password to continue.</p>

        <form action={submit} className="mt-7 space-y-3">
          <div>
            <label className="label mb-1.5" htmlFor="password">
              Password
            </label>
            <PasswordField
              id="password"
              name="password"
              autoComplete="current-password"
              autoFocus
              required
            />
          </div>

          {error ? (
            <p role="alert" className="text-[13px] font-medium text-red-700">
              That password is not correct.
            </p>
          ) : null}

          {/* "Unlocking…" and a turning ring while the password is checked and
              the session is started. Before this the press did nothing visible
              at all: the action runs on the server, lands on the company
              picker, and on a cold request that is a pause long enough to
              invite a second press. */}
          <SubmitButton label="Unlock" pendingLabel="Unlocking…" />
        </form>

        {usingDefaultPassword() ? (
          <p className="mt-6 rounded-lg bg-amber-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-amber-900">
            <strong className="font-semibold">This portal still has its default password.</strong>{" "}
            Set <code className="font-mono">PORTAL_PASSWORD</code> in{" "}
            <code className="font-mono">.env</code> before putting it anywhere reachable from the
            internet. For now it is <code className="font-mono">change-me</code>.
          </p>
        ) : null}
      </main>
    </>
  );
}

/**
 * The sheets drifting behind the form.
 *
 * Nine of them, each with its own width, tilt, pace and starting point, written
 * out rather than generated: a table of nine literals can be read and adjusted by
 * eye, which is how every number in it was arrived at. Widths are given and the
 * height follows from `aspect-[8.5/11]`, so they are Letter-proportioned by
 * construction and cannot go out of proportion if one is resized.
 *
 * `fixed` rather than `absolute`: this is the backdrop of a screen, not of the
 * column the form sits in — `<main>` is `max-w-sm`, so anchoring to it would pile
 * every sheet into a narrow strip down the middle. `overflow-hidden` because a
 * tilted rectangle sitting past the right edge would otherwise widen the page.
 *
 * `delay` is negative on every one, which is what makes the screen arrive already
 * full of sheets. Left at zero they would all start together at the bottom edge
 * and the screen would sit empty for the best part of a minute, which looks broken
 * rather than slow. Each value places its sheet at the height in `rest` on the
 * first frame: for a travel of 174vh, a delay of `-(112 - rest)/174 × drift`.
 *
 * Positions crowd the edges, where a wide screen has room to spare beside the
 * form, and only one passes through the middle — the faintest of the nine. On a
 * phone there is no outside to keep to and several pass behind the text, which at
 * this weight reads as paper under the words rather than as movement.
 *
 * The edge is `ink-soft` at low alpha rather than `ink-line`. `ink-line` is a
 * hairline *for a card*, chosen against white, and on the page's own off-white it
 * disappears — the first version of this was invisible in the light theme for
 * exactly that reason. One alpha, doing the same job in both themes.
 */
function DriftingSheets() {
  const sheets = [
    { left: "2%", width: 104, tilt: "-4deg", drift: "84s", delay: "-10s", rest: "92vh", opacity: 0.8 },
    { left: "11%", width: 72, tilt: "5deg", drift: "98s", delay: "-39s", rest: "42vh", opacity: 0.6 },
    { left: "21%", width: 122, tilt: "-3deg", drift: "76s", delay: "-45s", rest: "8vh", opacity: 0.7 },
    { left: "30%", width: 78, tilt: "6deg", drift: "106s", delay: "-27s", rest: "68vh", opacity: 0.55 },
    { left: "49%", width: 92, tilt: "-2deg", drift: "92s", delay: "-46s", rest: "25vh", opacity: 0.4 },
    { left: "68%", width: 112, tilt: "4deg", drift: "80s", delay: "-16s", rest: "78vh", opacity: 0.75 },
    { left: "77%", width: 68, tilt: "-5deg", drift: "100s", delay: "-47s", rest: "30vh", opacity: 0.6 },
    { left: "87%", width: 118, tilt: "3deg", drift: "88s", delay: "-29s", rest: "55vh", opacity: 0.8 },
    { left: "95%", width: 74, tilt: "-6deg", drift: "72s", delay: "-50s", rest: "-8vh", opacity: 0.5 },
  ];

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {sheets.map((sheet, i) => (
        <div
          key={i}
          className="sheet aspect-[8.5/11] rounded-[2px] border border-ink-soft/30 bg-card"
          style={
            {
              left: sheet.left,
              width: sheet.width,
              opacity: sheet.opacity,
              "--tilt": sheet.tilt,
              "--drift": sheet.drift,
              "--delay": sheet.delay,
              "--rest": sheet.rest,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
