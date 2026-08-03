import type { Company } from "./companies";

/**
 * What a company workspace contains.
 *
 * Each module owns a URL segment and its own tabs. The workspace shell reads
 * this to draw the navigation, so adding a module means adding an entry here
 * and the pages under its segment — nothing else in the shell changes.
 *
 * Badge counts are supplied by the shell rather than fetched here, because the
 * shell already loads them for the header and this file must stay free of any
 * database import (it is used by client components).
 */

export type ModuleKey = "vouchers" | "po" | "rfq";

export interface ModuleTab {
  /** Appended to the module's base path. "" is the module's own index. */
  segment: string;
  label: string;
  /** Which count, if any, shows as a badge beside the label. */
  badge?: ModuleKey;
}

export interface PortalModule {
  key: ModuleKey;
  /** URL segment under /[company]. */
  segment: string;
  /** Name in the module switcher. */
  label: string;
  /** One line, for the workspace landing card. */
  blurb: string;
  tabs: ModuleTab[];
  /** Where the module switcher sends you. */
  home: string;
}

export const MODULES: PortalModule[] = [
  {
    key: "vouchers",
    segment: "vouchers",
    label: "Vouchers",
    blurb: "Numbered payment acknowledgment vouchers, and the signed scans that close them.",
    home: "new",
    tabs: [
      { segment: "new", label: "Generate" },
      { segment: "pending", label: "Pending", badge: "vouchers" },
      { segment: "history", label: "History" },
    ],
  },
  {
    key: "po",
    segment: "po",
    label: "Purchase Orders",
    blurb: "Orders raised on vendors, priced and totalled, ready to issue as a PDF.",
    home: "",
    tabs: [
      { segment: "new", label: "New PO" },
      { segment: "", label: "Open", badge: "po" },
      { segment: "history", label: "History" },
    ],
  },
  {
    key: "rfq",
    segment: "rfq",
    label: "Quotations",
    blurb:
      "Requests for quotation \u2014 what you want priced, with the prices left blank for the vendor.",
    home: "",
    tabs: [
      { segment: "new", label: "New request" },
      { segment: "", label: "Open", badge: "rfq" },
      { segment: "history", label: "History" },
    ],
  },
];

/** Badge counts the nav renders, keyed by module. */
export type ModuleBadges = Partial<Record<ModuleKey, number>>;

export function modulePath(company: string, module: PortalModule, tab: string): string {
  return tab ? `/${company}/${module.segment}/${tab}` : `/${company}/${module.segment}`;
}

export function moduleHome(company: string, module: PortalModule): string {
  return modulePath(company, module, module.home);
}

/** Which module a pathname is inside. Defaults to the first. */
export function activeModule(pathname: string, company: string): PortalModule {
  const found = MODULES.find(
    (m) => pathname === `/${company}/${m.segment}` || pathname.startsWith(`/${company}/${m.segment}/`),
  );
  return found ?? MODULES[0];
}

/** Every module a company has. Kept as a function so a company can later opt out. */
export function modulesFor(_company: Company): PortalModule[] {
  return MODULES;
}
