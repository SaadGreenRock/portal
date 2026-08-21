"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import NavPending from "@/components/NavPending";

/**
 * Tabs for the funding section.
 *
 * One row, like the food log's and unlike a workspace's two: there is no module
 * to switch between here, so the "which part of the portal am I in" question has
 * already been answered by being at /funding at all.
 *
 * The badge is the work queue — expenses with money not yet attributed to any
 * tranche. A count of tranches would be a fact about the ledger; a count of
 * things still to file is something to act on, which is the same distinction the
 * food log's Outstanding badge draws.
 */
export default function FundingNav({ queued }: { queued: number }) {
  const pathname = usePathname();

  const tabs = [
    { href: "/funding", label: "Tranches", exact: true, badge: 0 },
    { href: "/funding/allocate", label: "Allocate", exact: false, badge: queued },
    { href: "/funding/expenses", label: "Direct entries", exact: false, badge: 0 },
  ];

  return (
    <nav>
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          // /funding is a prefix of every other tab's URL, so it only matches
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
