"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import NavPending from "@/components/NavPending";
import {
  MODULES,
  activeModule,
  moduleHome,
  modulePath,
  type ModuleBadges,
} from "@/lib/modules";

/**
 * Workspace navigation: which module you are in, then that module's tabs.
 *
 * Two rows rather than one flat list. With more than one module a single row
 * either grows past the width of a phone or forces the labels to be so terse
 * they stop meaning anything; splitting it keeps "which part of the portal am
 * I in" and "which screen" as separate, always-visible questions.
 */
export default function WorkspaceNav({
  slug,
  badges,
}: {
  slug: string;
  badges: ModuleBadges;
}) {
  const pathname = usePathname();
  const settingsPath = `/${slug}/settings`;
  const inSettings = pathname === settingsPath || pathname.startsWith(`${settingsPath}/`);
  const overviewPath = `/${slug}`;
  const inOverview = pathname === overviewPath;
  const current = activeModule(pathname, slug);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      {/* ---- module switcher ---------------------------------------------- */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2.5">
        {/* The workspace overview. First, because it is where a visit starts. */}
        <Link
          href={overviewPath}
          aria-current={inOverview ? "page" : undefined}
          className={`relative shrink-0 rounded-lg px-3 py-1.5 text-[13.5px] font-semibold transition-colors ${
            inOverview
              ? "text-[var(--accent-text)]"
              : "text-ink-soft hover:bg-wash-strong hover:text-ink"
          }`}
          style={inOverview ? { background: "var(--accent)" } : undefined}
        >
          Overview
          <NavPending className="inset-x-3 bottom-1" />
        </Link>

        {MODULES.map((m) => {
          const on = !inSettings && !inOverview && m.key === current.key;
          const count = badges[m.key] ?? 0;
          return (
            <Link
              key={m.key}
              href={moduleHome(slug, m)}
              aria-current={on ? "page" : undefined}
              className={`relative flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-[13.5px] font-semibold transition-colors ${
                on
                  ? "text-[var(--accent-text)]"
                  : "text-ink-soft hover:bg-wash-strong hover:text-ink"
              }`}
              style={on ? { background: "var(--accent)" } : undefined}
            >
              {m.label}
              {count > 0 ? (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums ${
                    on ? "badge-on-accent" : "bg-ink-rule text-ink"
                  }`}
                >
                  {count}
                </span>
              ) : null}
              <NavPending className="inset-x-3 bottom-1" />
            </Link>
          );
        })}

        {/* Everything past this rule leaves the workspace — Food and
            Expenditure belong to both companies, and Help to neither. Set apart
            with a divider and a lighter weight so they don't read as two more
            modules of the company you are in. */}
        <span aria-hidden className="ml-auto h-5 w-px shrink-0 bg-ink-line" />
        <Link
          href="/food"
          className="relative shrink-0 rounded-lg px-3 py-1.5 text-[13.5px] font-medium text-ink-soft transition-colors hover:bg-wash-strong hover:text-ink"
        >
          Food
          <NavPending className="inset-x-3 bottom-1" />
        </Link>
        <Link
          href="/spend"
          className="relative shrink-0 rounded-lg px-3 py-1.5 text-[13.5px] font-medium text-ink-soft transition-colors hover:bg-wash-strong hover:text-ink"
        >
          Expenditure
          <NavPending className="inset-x-3 bottom-1" />
        </Link>
        <Link
          href={settingsPath}
          aria-current={inSettings ? "page" : undefined}
          className={`relative shrink-0 rounded-lg px-3 py-1.5 text-[13.5px] font-medium transition-colors ${
            inSettings ? "bg-wash-strong text-ink" : "text-ink-soft hover:bg-wash-strong hover:text-ink"
          }`}
        >
          Settings
          <NavPending className="inset-x-3 bottom-1" />
        </Link>
        <Link
          href="/help"
          className="relative shrink-0 rounded-lg px-3 py-1.5 text-[13.5px] font-medium text-ink-soft transition-colors hover:bg-wash-strong hover:text-ink"
        >
          Help
          <NavPending className="inset-x-3 bottom-1" />
        </Link>
      </div>

      {/* ---- tabs within the module --------------------------------------- */}
      {inSettings || inOverview ? null : (
        <nav>
          <ul className="-mb-px flex gap-1 overflow-x-auto">
            {current.tabs.map((tab) => {
              const href = modulePath(slug, current, tab.segment);
              // An empty segment is the module index, which every other tab's
              // URL is a prefix of — so it only matches exactly.
              const active = tab.segment
                ? pathname === href || pathname.startsWith(`${href}/`)
                : pathname === href;
              const count = tab.badge ? (badges[tab.badge] ?? 0) : 0;

              return (
                <li key={tab.segment || "index"}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-[14px] font-medium transition-colors ${
                      active
                        ? "border-[var(--accent)] text-ink"
                        : "border-transparent text-ink-soft hover:text-ink"
                    }`}
                  >
                    {tab.label}
                    {count > 0 ? (
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-amber-900">
                        {count}
                      </span>
                    ) : null}
                    <NavPending className="inset-x-0 -bottom-0.5" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
