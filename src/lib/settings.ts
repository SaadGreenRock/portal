/**
 * Per-company settings that the operator can change without a deploy.
 *
 * Anything fixed about a company — its brand, its legal name, its voucher
 * wording — belongs in companies.ts. Anything that is a working default the
 * operator may want to adjust belongs here, stored as one JSON document per
 * company so a new module can add a section without a schema migration.
 */

/** Defaults applied to every new purchase order. All are editable per PO. */
export interface PoSettings {
  /** Currency code, a key of CURRENCIES in money.ts. */
  currency: string;
  /** What the tax row is called on the document: "GST", "VAT", "Sales Tax". */
  taxLabel: string;
  /** Percent, e.g. 18 for 18%. */
  taxRate: number;
  /** Off hides the tax row entirely. */
  showTax: boolean;
  /** "30 days from invoice", "50% advance, balance on delivery"… */
  paymentTerms: string;
  /** Where goods are delivered — prints as the Ship To block. */
  deliveryAddress: string;
  /** Terms and conditions printed at the foot of every PO. */
  terms: string;
  /** Name on the "Prepared By" signature line. */
  preparedBy: string;
  /** Name on the "Approved By" signature line. */
  approvedBy: string;
}

/** Defaults applied to every new request for quotation. Editable per request. */
export interface RfqSettings {
  /** Currency vendors are asked to quote in. */
  currency: string;
  /** Default number of days vendors get to reply. */
  replyWithinDays: number;
  /** Where goods would be delivered — vendors need it to price freight. */
  deliveryAddress: string;
  /** Who the vendor sends the quotation back to. */
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  /** Conditions of quoting, printed at the foot of every request. */
  terms: string;
  preparedBy: string;
}

export interface CompanySettings {
  po: PoSettings;
  rfq: RfqSettings;
}

const DEFAULT_TERMS = [
  "1. This purchase order number must be quoted on all invoices, delivery notes and correspondence.",
  "2. Goods remain rejectable on delivery if they differ from the description, quantity or specification stated above.",
  "3. Delivery must be made by the date stated. Delays must be notified in writing before that date.",
  "4. Invoices are payable only against a signed delivery receipt.",
  "5. Prices are firm for the duration of this order and include all charges unless stated otherwise.",
].join("\n");

const DEFAULT_RFQ_TERMS = [
  "1. Please quote your best price per unit, in the currency stated above, inclusive of all charges.",
  "2. State clearly any item you cannot supply, and any substitute you are offering in its place.",
  "3. State your delivery lead time from the date of order for each item.",
  "4. Quoted prices must remain valid for 30 days from the date of your quotation.",
  "5. This request is not an order and places no obligation on either party.",
].join("\n");

export const DEFAULT_SETTINGS: CompanySettings = {
  po: {
    currency: "PKR",
    taxLabel: "GST",
    taxRate: 18,
    showTax: true,
    paymentTerms: "30 days from invoice",
    deliveryAddress: "",
    terms: DEFAULT_TERMS,
    preparedBy: "",
    approvedBy: "",
  },
  rfq: {
    currency: "PKR",
    replyWithinDays: 7,
    deliveryAddress: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    terms: DEFAULT_RFQ_TERMS,
    preparedBy: "",
  },
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const num = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/**
 * Rebuilds a complete settings object from whatever is stored.
 *
 * Stored settings are JSON written by an earlier version of the app, so every
 * field is validated rather than trusted: a missing section, a renamed key or a
 * hand-edited value falls back to the shipped default instead of rendering a
 * document with `undefined` on it.
 */
export function mergeSettings(stored: unknown): CompanySettings {
  if (!isRecord(stored)) return DEFAULT_SETTINGS;
  const po = isRecord(stored.po) ? stored.po : {};
  const rfq = isRecord(stored.rfq) ? stored.rfq : {};
  const d = DEFAULT_SETTINGS.po;
  const r = DEFAULT_SETTINGS.rfq;

  return {
    po: {
      currency: str(po.currency, d.currency).toUpperCase(),
      taxLabel: str(po.taxLabel, d.taxLabel),
      // Clamped: a negative or absurd rate would silently produce a wrong total.
      taxRate: Math.min(100, Math.max(0, num(po.taxRate, d.taxRate))),
      showTax: bool(po.showTax, d.showTax),
      paymentTerms: str(po.paymentTerms, d.paymentTerms),
      deliveryAddress: str(po.deliveryAddress, d.deliveryAddress),
      terms: str(po.terms, d.terms),
      preparedBy: str(po.preparedBy, d.preparedBy),
      approvedBy: str(po.approvedBy, d.approvedBy),
    },
    rfq: {
      currency: str(rfq.currency, r.currency).toUpperCase(),
      // Clamped: a negative window would put the reply date in the past.
      replyWithinDays: Math.min(365, Math.max(0, num(rfq.replyWithinDays, r.replyWithinDays))),
      deliveryAddress: str(rfq.deliveryAddress, r.deliveryAddress),
      contactName: str(rfq.contactName, r.contactName),
      contactEmail: str(rfq.contactEmail, r.contactEmail),
      contactPhone: str(rfq.contactPhone, r.contactPhone),
      terms: str(rfq.terms, r.terms),
      preparedBy: str(rfq.preparedBy, r.preparedBy),
    },
  };
}
