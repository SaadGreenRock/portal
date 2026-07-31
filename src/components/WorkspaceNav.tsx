"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { segment: "new", label: "Generate" },
  { segment: "pending", label: "Pending" },
  { segment: "history", label: "History" },
  { segment: "settings", label: "Settings" },
] as const;

/**
 * Workspace tabs. Scrolls horizontally rather than wrapping so the bar stays
 * one line deep on a phone.
 */
export default function WorkspaceNav({ slug, pending }: { slug: string; pending: number }) {
  const pathname = usePathname();

  return (
    <nav className="mx-auto max-w-6xl px-4 sm:px-6">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {TABS.map(({ segment, label }) => {
          const href = `/${slug}/${segment}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={segment}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-[14px] font-medium transition-colors ${
                  active
                    ? "border-[var(--accent)] text-ink"
                    : "border-transparent text-ink-soft hover:text-ink"
                }`}
              >
                {label}
                {segment === "pending" && pending > 0 ? (
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">
                    {pending}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
