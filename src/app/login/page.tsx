import { redirect } from "next/navigation";
import LockMark from "@/components/LockMark";
import PasswordField from "@/components/PasswordField";
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
    <main className="relative mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-16">
      {/* Reachable before unlocking, on purpose. This is the first screen the
          portal shows and often the only one showing for a while; somebody who
          keeps their machine dark should be able to settle that here rather than
          having to get past the password first. */}
      <ThemeToggleCorner />

      {/* The one thing that moves on this screen — a slow, calm breathing
          pulse, so waiting to type the password isn't spent looking at
          something completely still. */}
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

        <button type="submit" className="btn btn-primary w-full">
          Unlock
        </button>
      </form>

      {usingDefaultPassword() ? (
        <p className="mt-6 rounded-lg bg-amber-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-amber-900">
          <strong className="font-semibold">This portal still has its default password.</strong>{" "}
          Set <code className="font-mono">PORTAL_PASSWORD</code> in <code className="font-mono">.env</code>{" "}
          before putting it anywhere reachable from the internet. For now it is{" "}
          <code className="font-mono">change-me</code>.
        </p>
      ) : null}
    </main>
  );
}
