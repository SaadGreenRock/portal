"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import NavPending from "@/components/NavPending";

/**
 * Tabs for the food section.
 *
 * A single row, unlike `WorkspaceNav`'s two: there is no module to switch
 * between here, so the "which part of the portal am I in" question the top row
 * answers has already been answered by being at /food at all.
 *
 * The badge is what is still owed, not how many entries exist. A count of
 * entries is a fact about the log; a count of debts is something to act on.
 */
export default function FoodNav({ pending }: { pending: number }) {
  const pathname = usePathname();

  const tabs = [
    { href: "/food", label: "Log", exact: true, badge: 0 },
    { href: "/food/outstanding", label: "Outstanding", exact: false, badge: pending },
    { href: "/food/report", label: "Report", exact: false, badge: 0 },
  ];

  return (
    <nav>
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          // /food is a prefix of every other tab's URL, so it only matches
          // exactly; the others match their own sub-paths too.
          const active = tab.exact
            ? pathname === tab.href
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);

          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-[14px] font-medium transition-colors ${
                  active
                    ? "border-[var(--accent)] text-ink"
                    : "border-transparent text-ink-soft hover:text-ink"
                }`}
              >
                {tab.label}
                {tab.badge > 0 ? (
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-amber-900">
                    {tab.badge}
                  </span>
                ) : null}
                <NavPending className="inset-x-0 -bottom-0.5" />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
