import { redirect } from "next/navigation";
import {
  checkPassword,
  isAuthenticated,
  startSession,
  usingDefaultPassword,
} from "@/lib/auth";

/**
 * The whole authentication system: one password, one cookie.
 * The plan calls for a single operator, so there is nothing to model here.
 */
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  // Only ever redirect to a path on this site, never to an absolute URL.
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (await isAuthenticated()) redirect(safeNext);

  async function submit(formData: FormData) {
    "use server";
    const password = String(formData.get("password") ?? "");
    const target = String(formData.get("next") ?? "/");
    const dest = target.startsWith("/") && !target.startsWith("//") ? target : "/";

    if (!checkPassword(password)) {
      redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
    }
    await startSession();
    redirect(dest);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-16">
      <h1 className="text-[22px] font-bold tracking-tight">Payment Voucher Portal</h1>
      <p className="mt-1.5 text-[14px] text-ink-soft">Enter the portal password to continue.</p>

      <form action={submit} className="mt-7 space-y-3">
        <input type="hidden" name="next" value={safeNext} />
        <div>
          <label className="label mb-1.5" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            className="input"
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
