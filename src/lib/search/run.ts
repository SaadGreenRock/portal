import { COMPANY_LIST } from "../companies";
import type { Store } from "../db/types";
import { tryTable } from "../db/resilience";
import { todayIso } from "../format";
import { toNumber } from "../money";
import type { ToggleKey, VoucherFields } from "../types";
import { destinations } from "./destinations";
import { parseQuery, probeTerm, rank, type Scored, type SearchHit } from "./types";

/**
 * Global search, assembled by asking every module the same question.
 *
 * Deliberately no search index, no FTS table and no migration — and that is a
 * decision about *this* portal rather than a general opinion. Two facts make the
 * simple thing the right one here:
 *
 *   The corpus is a small company's paperwork. Vouchers, orders, quotations,
 *   assets, employees, notifications, food, miscellaneous payments and the
 *   funding ledger together are thousands of rows, not millions. An index buys
 *   speed that nobody would perceive.
 *
 *   Every module already has a `search` that knows which of its own columns are
 *   worth matching. Reusing those means one opinion about what a voucher is
 *   findable by, not two that drift — and it means this feature adds no column,
 *   no trigger and nothing for the operator to run before it works.
 *
 * The cost is that the database filters on one term and this file applies the
 * rest. At this size that is a rounding error, and `probeTerm` picks the term
 * most likely to narrow hardest. It would need revisiting at tens of thousands
 * of records — the same line the expenditure and funding modules draw.
 *
 * Every read is wrapped in `tryTable`. A module whose tables are not set up on
 * this deployment contributes nothing and search still works, exactly as the
 * expenditure report already degrades — a portal where the search box is broken
 * because Quotations was never migrated would be worse than one that quietly
 * searches eight modules instead of nine.
 */

/**
 * How many rows each module is asked for.
 *
 * Generous, because this is a coarse filter and the real ranking happens after
 * it: the query going down is one term of possibly several, so a module can
 * legitimately return forty rows of which two survive scoring. Small enough that
 * nine modules across two companies stays a cheap set of parallel reads.
 */
const PER_MODULE = 40;

/** What the palette shows at once. */
const LIMIT = 24;

/** Shortest query worth running. One character matches most of the portal. */
const MIN_CHARS = 2;

/**
 * The cap when the query is a bare figure — "4200", meaning "what did we pay
 * 4,200 for".
 *
 * No module's `search` looks inside its amount column, so there is no text to
 * filter on and the rows have to be fetched and matched here. Higher than
 * `PER_MODULE` because this is a scan rather than a filter: what comes back is
 * simply the most recent N, and anything older than that is invisible to an
 * amount search. At a few hundred rows a module that is the whole corpus; it is
 * the one query shape in here that would need a real index to scale, and the
 * honest place to say so is here.
 */
const AMOUNT_SCAN = 250;

/**
 * A voucher's printed values, read defensively.
 *
 * The same care `spend/report.ts` takes and for the same reason: this runs over
 * every stored voucher including ones written before the toggle block existed,
 * where `fields.on` is undefined and a direct read throws. A missing toggle
 * counts as on, so a legacy voucher stays findable by what it actually printed.
 */
function voucherText(fields: VoucherFields | null | undefined) {
  const f = fields ?? ({} as VoucherFields);
  const on = (f.on ?? {}) as Partial<Record<ToggleKey, boolean>>;
  const shown = (key: ToggleKey) => on[key] ?? true;
  const amount = shown("amount") ? toNumber(f.amount) : null;
  return {
    recipientName: shown("recipientName") ? (f.recipientName ?? "").trim() : "",
    description: shown("description") ? (f.description ?? "").trim() : "",
    phone: shown("phone") ? (f.phone ?? "").trim() : "",
    voucherDate: shown("voucherDate") ? f.voucherDate || "" : "",
    amount: amount != null && Number.isFinite(amount) ? amount : null,
  };
}

const day = (own: string | null | undefined, createdAt: string): string =>
  (own || createdAt || "").slice(0, 10);

export async function searchEverything(
  db: Store,
  raw: string,
  today: string = todayIso(),
): Promise<Scored[]> {
  const q = parseQuery(raw);
  if (q.raw.length < MIN_CHARS) return [];

  // A bare figure has nothing to filter on — see AMOUNT_SCAN.
  const byAmount = q.amount != null;
  const probe = byAmount ? "" : probeTerm(q);
  const cap = byAmount ? AMOUNT_SCAN : PER_MODULE;
  const hits: SearchHit[] = [];

  // Pages first and locally: a destination is not a database read, and somebody
  // typing "expenditure" wants the screen, not a record that mentions the word.
  hits.push(...destinations());

  // Every module, both companies, in one pass. Sequential round trips would be
  // a visible pause on a hosted backend, and this runs on every keystroke the
  // debounce lets through.
  const perCompany = await Promise.all(
    COMPANY_LIST.map(async (company) => {
      const [vouchers, orders, rfqs, assets, employees, notifications, misc] = await Promise.all([
        tryTable(() => db.search({ company: company.slug, q: probe, status: "all", limit: cap })),
        tryTable(() => db.searchPos({ company: company.slug, q: probe, status: "all", limit: cap })),
        tryTable(() => db.searchRfqs({ company: company.slug, q: probe, status: "all", limit: cap })),
        tryTable(() => db.searchAssets({ company: company.slug, q: probe, view: "all", limit: cap })),
        tryTable(() => db.searchEmployees({ company: company.slug, q: probe, view: "all", limit: cap })),
        tryTable(() => db.searchNotifications({ company: company.slug, q: probe, status: "all", limit: cap })),
        tryTable(() => db.searchMisc({ company: company.slug, q: probe, view: "all", limit: cap })),
      ]);
      return { company, vouchers, orders, rfqs, assets, employees, notifications, misc };
    }),
  );

  // The three that belong to no company.
  const [food, tranches, direct] = await Promise.all([
    tryTable(() => db.searchFood({ q: probe, view: "all", limit: cap })),
    tryTable(() => db.fundingLedger()),
    tryTable(() => db.listDirect()),
  ]);

  for (const set of perCompany) {
    const slug = set.company.slug;

    if (set.vouchers.ok) {
      for (const v of set.vouchers.value.rows) {
        const t = voucherText(v.fields);
        hits.push({
          kind: "voucher",
          id: v.id,
          ref: v.voucherNo,
          title: t.recipientName || "No recipient recorded",
          detail: t.description,
          company: slug,
          date: day(t.voucherDate, v.createdAt),
          // PKR by construction — the template prints "AMOUNT PAID (PKR)".
          amount: t.amount,
          currency: "PKR",
          status: v.status === "completed" ? "Signed" : "Awaiting signature",
          href: `/${slug}/vouchers/${v.id}`,
          extra: `${t.phone} ${v.internalNote}`,
        });
      }
    }

    if (set.orders.ok) {
      for (const po of set.orders.value.rows) {
        const doc = po.doc ?? ({} as (typeof po)["doc"]);
        hits.push({
          kind: "po",
          id: po.id,
          ref: po.poNo,
          title: doc.vendor?.name || "No vendor recorded",
          detail: doc.subject || "",
          company: slug,
          date: day(doc.poDate, po.createdAt),
          amount: po.total ?? null,
          currency: doc.currency || "PKR",
          status: po.status,
          href: `/${slug}/po/${po.id}`,
          extra: `${po.internalNote} ${(doc.items ?? []).map((i) => i.description).join(" ")}`,
        });
      }
    }

    if (set.rfqs.ok) {
      for (const rfq of set.rfqs.value.rows) {
        const doc = rfq.doc ?? ({} as (typeof rfq)["doc"]);
        hits.push({
          kind: "rfq",
          id: rfq.id,
          ref: rfq.rfqNo,
          title: doc.subject || "No subject recorded",
          detail: doc.contactName || "",
          company: slug,
          date: day(doc.rfqDate, rfq.createdAt),
          amount: null,
          currency: doc.currency || "PKR",
          status: rfq.status,
          href: `/${slug}/rfq/${rfq.id}`,
          extra: `${rfq.internalNote} ${(doc.items ?? []).map((i) => i.description).join(" ")}`,
        });
      }
    }

    if (set.assets.ok) {
      for (const a of set.assets.value.rows) {
        hits.push({
          kind: "asset",
          id: a.id,
          ref: a.assetNo,
          title: a.assetName,
          // Who has it is the second thing anybody wants to know about an asset,
          // and often the thing they are actually searching for.
          detail: a.holderName ? `With ${a.holderName}` : "In stock",
          company: slug,
          date: a.heldSince || "",
          amount: null,
          currency: "PKR",
          status: a.holderName ? "Out" : "In stock",
          href: `/${slug}/assets/${a.id}`,
          extra: a.holderNo,
        });
      }
    }

    if (set.employees.ok) {
      for (const e of set.employees.value.rows) {
        hits.push({
          kind: "employee",
          id: e.id,
          ref: e.employeeNo,
          title: e.name,
          detail: e.status === "active" ? "" : "Left",
          company: slug,
          date: "",
          amount: null,
          currency: "PKR",
          status: e.status === "active" ? "" : "Left",
          href: `/${slug}/employees/${e.id}`,
          // Findable by the things somebody actually has to hand: a phone
          // number off a call log, a CNIC off a photocopy.
          extra: `${e.phone ?? ""} ${e.cnic ?? ""} ${e.passport ?? ""} ${e.kinName ?? ""} ${e.notes ?? ""}`,
        });
      }
    }

    if (set.notifications.ok) {
      for (const n of set.notifications.value.rows) {
        hits.push({
          kind: "notification",
          id: n.id,
          ref: n.notifNo,
          title: n.headline,
          detail: n.sender,
          company: slug,
          date: day(n.notifyDate, n.createdAt),
          amount: null,
          currency: "PKR",
          status: "",
          href: `/${slug}/notifications/${n.id}`,
          extra: n.body,
        });
      }
    }

    if (set.misc.ok) {
      for (const m of set.misc.value.rows) {
        hits.push({
          kind: "misc",
          id: m.id,
          ref: m.paymentNo,
          // A miscellaneous payment has no payee — the note is all there is, so
          // it takes the title line rather than being demoted to the detail.
          title: m.notes,
          detail: "",
          company: slug,
          date: m.date,
          amount: m.amount,
          currency: m.currency,
          status: m.proofKey ? "Receipt" : "",
          href: `/${slug}/misc/${m.id}`,
        });
      }
    }
  }

  if (food.ok) {
    for (const f of food.value.rows) {
      hits.push({
        kind: "food",
        id: f.id,
        ref: f.entryNo,
        title: f.vendor,
        detail: f.details,
        // Belongs to neither workspace, which is the food log's founding rule.
        company: null,
        date: f.date,
        amount: f.amount,
        currency: f.currency,
        status: f.status === "paid" ? "Paid" : "Pending",
        href: `/food/${f.id}`,
        extra: `${f.orderedFor} ${f.paidBy ?? ""} ${f.reference ?? ""} ${f.notes ?? ""}`,
      });
    }
  }

  // Unpaged, both of them: the funding ledger is tens of rows, not thousands,
  // and neither store method takes a query to filter on.
  if (tranches.ok) {
    for (const { tranche: t } of tranches.value) {
      hits.push({
        kind: "tranche",
        id: t.id,
        ref: t.trancheNo,
        title: t.label || t.funder,
        detail: t.funder,
        company: null,
        date: t.recvDate,
        amount: t.recvAmount,
        currency: t.recvCurrency,
        status: "",
        href: `/funding/${t.id}`,
        extra: `${t.account ?? ""} ${t.reference ?? ""} ${t.notes ?? ""}`,
      });
    }
  }

  if (direct.ok) {
    for (const d of direct.value) {
      hits.push({
        kind: "direct",
        id: d.id,
        ref: d.entryNo,
        title: d.payee,
        detail: d.details,
        company: d.company,
        date: d.date,
        amount: d.amount,
        currency: d.currency,
        status: "",
        href: `/funding/expenses/${d.id}`,
        extra: d.notes ?? "",
      });
    }
  }

  return rank(hits, q, today, LIMIT);
}
