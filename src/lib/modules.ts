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

export type ModuleKey =
  | "vouchers"
  | "po"
  | "rfq"
  | "misc"
  | "assets"
  | "employees"
  | "notifications";

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

/**
 * Two conventions hold across every entry, and they are the reason this file is
 * worth reading before adding a module:
 *
 *   Tabs run [ the working list ] · [ New … ] · [ History ].
 *     Whoever is sitting at the portal this month may not be whoever set it up.
 *     Landing on a list shows them what exists before asking them to add to it,
 *     and the create button is on that list anyway. Modules that opened straight
 *     into a blank form taught nothing, and assumed the visit was to type.
 *
 *   The create tab is always "New <thing>", spelled out.
 *     This previously offered Generate, New, Raise, Log and Compose for one
 *     idea — and purchase orders alone used three different names across screens
 *     that linked to each other. One word everywhere, so it never has to be
 *     learned twice. Page headings and submit buttons still describe what they
 *     actually do; it is the navigation that has to be predictable.
 */
export const MODULES: PortalModule[] = [
  {
    key: "vouchers",
    segment: "vouchers",
    label: "Vouchers",
    blurb: "Numbered payment acknowledgment vouchers, and the signed scans that close them.",
    home: "pending",
    tabs: [
      { segment: "pending", label: "Pending", badge: "vouchers" },
      { segment: "new", label: "New voucher" },
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
      { segment: "", label: "Open", badge: "po" },
      { segment: "new", label: "New purchase order" },
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
      { segment: "", label: "Open", badge: "rfq" },
      { segment: "new", label: "New quotation request" },
      { segment: "history", label: "History" },
    ],
  },
  {
    key: "misc",
    segment: "misc",
    label: "Miscellaneous",
    blurb:
      "Payments with no document behind them \u2014 a date, an amount, a note, and the receipt if there is one.",
    home: "",
    // No badge, for the reason the asset register gives about being out with
    // somebody: a payment without a receipt is an ordinary state of a payment,
    // not a task waiting on the operator. Half of these will never have one —
    // that is the point of the module — and a count that is permanently lit
    // teaches you to stop reading it.
    //
    // Two tabs rather than three. Every other module splits its working list
    // from its history because the two answer different questions; here they are
    // the same question, since a payment is logged once and never moves through
    // a lifecycle. The log's own filters cover the period and the recycle bin,
    // so a History tab would be the same screen reached by a second name.
    tabs: [
      { segment: "", label: "Payments" },
      { segment: "new", label: "New payment" },
    ],
  },
  {
    key: "assets",
    segment: "assets",
    label: "Assets",
    blurb: "Which numbered asset is with which employee, and everyone who had it before.",
    home: "",
    // No badge: an asset being out with somebody is the normal state of an
    // asset, not a task waiting on the operator, and a count that is always
    // lit teaches you to stop reading it.
    tabs: [
      { segment: "", label: "Register" },
      { segment: "new", label: "New asset" },
      { segment: "history", label: "History" },
    ],
  },
  {
    key: "employees",
    segment: "employees",
    label: "Employees",
    blurb: "Who works here, their documents and contact details, and what they are holding.",
    home: "",
    // No badge: a company having employees is the normal state of a company, not
    // a task waiting on the operator — the same reasoning the asset register
    // gives for having none.
    tabs: [
      { segment: "", label: "Register" },
      { segment: "new", label: "New employee" },
    ],
  },
  {
    key: "notifications",
    segment: "notifications",
    label: "Notifications",
    blurb: "Branded announcement cards — a PNG for WhatsApp and a PDF for email — with a log of everything sent.",
    home: "history",
    // No badge: a notification is composed once and never left pending, so
    // there is nothing here for a count to be waiting on.
    //
    // History takes the list-first slot the other four give their outstanding
    // work: there is no "open" state a notification can be in, so the log of
    // what has been sent is this module's working list.
    tabs: [
      { segment: "history", label: "History" },
      { segment: "new", label: "New notification" },
    ],
  },
];

/**
 * The module's create screen.
 *
 * Every module has a "new" tab; the fallback only exists so a future module
 * without one cannot crash the workspace overview.
 */
export function moduleCreateTab(module: PortalModule): ModuleTab {
  return module.tabs.find((t) => t.segment === "new") ?? module.tabs[0];
}

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
