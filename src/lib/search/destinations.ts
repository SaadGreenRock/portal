import { COMPANY_LIST } from "../companies";
import { MODULES, modulePath } from "../modules";
import type { SearchHit } from "./types";

/**
 * The screens themselves, searchable alongside the records.
 *
 * Half of what anybody types into a search box is not a search — it is
 * navigation with the keyboard because reaching for the tab is slower. "new
 * voucher", "outstanding", "expenditure" are all requests to *go* somewhere, and
 * a search that answers them with records that happen to contain the word has
 * misread the question. So the destinations are hits like any other and are
 * ranked by the same function; they win when the query is their name because a
 * title match outscores a description match, not because they are special-cased.
 *
 * Built from the module registry rather than listed by hand, so a module added
 * later is findable by name on the day it ships and nobody has to remember this
 * file exists. Only the shared sections below are written out, because they are
 * the ones that belong to no company and therefore to no registry.
 */

interface Destination {
  title: string;
  detail: string;
  href: string;
  /** Words worth matching that are not in the title — what people call it. */
  extra?: string;
}

/** Sections outside any company workspace. */
const SHARED: Destination[] = [
  {
    title: "Home",
    detail: "The company picker, and everything that belongs to neither",
    href: "/",
    extra: "companies switch start front landing",
  },
  {
    title: "Expenditure",
    detail: "Both companies together, and each on its own",
    href: "/spend",
    extra: "spend spending totals money outgoings",
  },
  {
    title: "Expense report",
    detail: "Every expense in detail, laid out for printing",
    href: "/spend/report",
    extra: "print pdf statement",
  },
  {
    title: "Food & refreshments",
    detail: "Lunches, snacks and drinks — both companies, one log",
    href: "/food",
    extra: "lunch tea meals cafe catering",
  },
  {
    title: "New food entry",
    detail: "Log an order",
    href: "/food/new",
    extra: "add lunch",
  },
  {
    title: "Outstanding food",
    detail: "What is still owed, and to whom",
    href: "/food/outstanding",
    extra: "owed pending unpaid tab settle",
  },
  {
    title: "Food report",
    detail: "The food log totalled for a period",
    href: "/food/report",
  },
  {
    title: "Funding & tranches",
    detail: "Dollars in, rupees out, and what each tranche paid for",
    href: "/funding",
    extra: "investor money in wire remittance",
  },
  {
    title: "New tranche",
    detail: "Record money received from an investor",
    href: "/funding/new",
  },
  {
    title: "Allocate expenses",
    detail: "Attribute expenses to a tranche",
    href: "/funding/allocate",
    extra: "attribute assign draw down",
  },
  {
    title: "Direct entries",
    detail: "Expenses that live only in the funding ledger",
    href: "/funding/expenses",
  },
  {
    title: "Help",
    detail: "How the portal works",
    href: "/help",
    extra: "guide manual how to instructions",
  },
];

/**
 * Every screen worth jumping to, as hits.
 *
 * `date` is empty and `amount` null throughout: a destination has neither, and
 * inventing a date would let the recency tiebreaker shuffle the screens about
 * for no reason.
 */
export function destinations(): SearchHit[] {
  const hits: SearchHit[] = [];

  for (const d of SHARED) {
    hits.push({
      kind: "page",
      id: d.href,
      ref: "",
      title: d.title,
      detail: d.detail,
      company: null,
      date: "",
      amount: null,
      currency: "PKR",
      status: "",
      href: d.href,
      extra: d.extra,
    });
  }

  for (const company of COMPANY_LIST) {
    hits.push({
      kind: "page",
      id: `/${company.slug}`,
      ref: "",
      title: `${company.name} overview`,
      detail: "What needs attention, and the way into each module",
      company: company.slug,
      date: "",
      amount: null,
      currency: "PKR",
      status: "",
      href: `/${company.slug}`,
      extra: "workspace dashboard",
    });

    for (const module of MODULES) {
      for (const tab of module.tabs) {
        hits.push({
          kind: "page",
          id: `${company.slug}:${module.segment}:${tab.segment}`,
          ref: "",
          // "New voucher — Green Rock" rather than "Vouchers → New voucher":
          // the tab label is already what somebody would type, and the module
          // name is what tells two companies' copies apart.
          title: tab.segment ? tab.label : module.label,
          detail: `${module.label} · ${company.name}`,
          company: company.slug,
          date: "",
          amount: null,
          currency: "PKR",
          status: "",
          href: modulePath(company.slug, module, tab.segment),
          extra: `${module.label} ${company.name} ${module.blurb}`,
        });
      }
    }

    hits.push({
      kind: "page",
      id: `${company.slug}:settings`,
      ref: "",
      title: "Settings",
      detail: `Company settings · ${company.name}`,
      company: company.slug,
      date: "",
      amount: null,
      currency: "PKR",
      status: "",
      href: `/${company.slug}/settings`,
      extra: "signatories defaults preferences configure",
    });
  }

  return hits;
}
