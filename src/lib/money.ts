/**
 * Currency formatting and amounts written out in words.
 *
 * The vouchers only ever needed PKR, so the original implementation hard-coded
 * Rupees and South Asian groupings. Purchase orders can be raised in another
 * currency, so the engine lives here and the currency supplies the unit names
 * and which grouping system to count in.
 *
 *   PKR  1250000 → "Twelve Lakh Fifty Thousand Rupees Only"
 *   SAR    51750 → "Fifty-One Thousand Seven Hundred Fifty Riyals Only"
 */

/**
 * How large numbers are grouped when spoken.
 * "south-asian"   — thousand, lakh, crore, arab
 * "international" — thousand, million, billion, trillion
 */
export type Grouping = "south-asian" | "international";

export interface Currency {
  /** ISO code, and what prints next to the figure. */
  code: string;
  /** Full name, for menus. */
  name: string;
  /** Main unit as it is spoken, plural: "Rupees". */
  unit: string;
  /** Fractional unit as it is spoken, plural: "Paisa". */
  subunit: string;
  grouping: Grouping;
  /**
   * Locale used for the digit separators.
   *
   * PKR is deliberately en-US, not en-IN: the vouchers have always printed
   * 1,250,000 rather than 12,50,000, and changing that would make a reprinted
   * voucher differ from the signed copy already in the file.
   */
  locale: string;
}

export const CURRENCIES: Record<string, Currency> = {
  PKR: {
    code: "PKR",
    name: "Pakistan Rupee",
    unit: "Rupees",
    subunit: "Paisa",
    grouping: "south-asian",
    locale: "en-US",
  },
  SAR: {
    code: "SAR",
    name: "Saudi Riyal",
    unit: "Riyals",
    subunit: "Halalas",
    grouping: "international",
    locale: "en-US",
  },
  AED: {
    code: "AED",
    name: "UAE Dirham",
    unit: "Dirhams",
    subunit: "Fils",
    grouping: "international",
    locale: "en-US",
  },
  USD: {
    code: "USD",
    name: "US Dollar",
    unit: "Dollars",
    subunit: "Cents",
    grouping: "international",
    locale: "en-US",
  },
  EUR: {
    code: "EUR",
    name: "Euro",
    unit: "Euros",
    subunit: "Cents",
    grouping: "international",
    locale: "en-US",
  },
  GBP: {
    code: "GBP",
    name: "Pound Sterling",
    unit: "Pounds",
    subunit: "Pence",
    grouping: "international",
    locale: "en-US",
  },
};

export const CURRENCY_LIST = Object.values(CURRENCIES);

/** Falls back to PKR so a bad stored code can never blank out a document. */
export function currency(code: string | null | undefined): Currency {
  return CURRENCIES[(code ?? "").toUpperCase()] ?? CURRENCIES.PKR;
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];

const TENS = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

/** 0–99 in words. Hyphenated above twenty, as in "Forty-Five". */
function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = ONES[n % 10];
  return o ? `${t}-${o}` : t;
}

/** 0–999 in words. */
function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(" ");
}

/**
 * The scale words for each grouping system, largest first. Both stop far above
 * anything a voucher or purchase order will ever carry.
 */
const SCALES: Record<Grouping, Array<[number, string]>> = {
  "south-asian": [
    [1_00_00_00_000, "Arab"],
    [1_00_00_000, "Crore"],
    [1_00_000, "Lakh"],
    [1_000, "Thousand"],
  ],
  international: [
    [1_000_000_000_000, "Trillion"],
    [1_000_000_000, "Billion"],
    [1_000_000, "Million"],
    [1_000, "Thousand"],
  ],
};

/** A whole number in words, grouped the way the currency's readers expect. */
function wholeNumberToWords(n: number, grouping: Grouping): string {
  if (n === 0) return "Zero";

  const parts: string[] = [];
  let remaining = n;

  for (const [value, label] of SCALES[grouping]) {
    const count = Math.floor(remaining / value);
    if (count > 0) {
      // International scales can carry a count above 999 only past a trillion,
      // which is beyond anything this handles; recurse so it still reads right.
      parts.push(
        `${count > 999 ? wholeNumberToWords(count, grouping) : threeDigits(count)} ${label}`,
      );
      remaining %= value;
    }
  }

  if (remaining > 0) parts.push(threeDigits(remaining));
  return parts.join(" ");
}

/** Parses whatever the operator typed — "1,250.50", 1250.5 — into a number. */
export function toNumber(amount: number | string | null | undefined): number | null {
  if (amount == null) return null;
  const n = typeof amount === "string" ? Number(amount.replace(/,/g, "").trim()) : amount;
  return Number.isFinite(n) ? n : null;
}

/**
 * The full "… Rupees Only" phrasing for an amount.
 *
 * Returns an empty string for anything that isn't a usable positive amount, so
 * callers can simply leave the line blank rather than branching.
 */
export function amountToWords(
  amount: number | string | null | undefined,
  code: string = "PKR",
): string {
  const n = toNumber(amount);
  if (n == null || n <= 0) return "";

  const c = currency(code);

  // Round to the fractional unit before splitting, so 1500.499 doesn't come out
  // as 49 paisa.
  const totalMinor = Math.round(n * 100);
  const major = Math.floor(totalMinor / 100);
  const minor = totalMinor % 100;

  const parts: string[] = [];
  if (major > 0) parts.push(`${wholeNumberToWords(major, c.grouping)} ${c.unit}`);
  if (minor > 0) {
    parts.push(`${major > 0 ? "and " : ""}${twoDigits(minor)} ${c.subunit}`);
  }

  return `${parts.join(" ")} Only`;
}

/**
 * Thousands separators for a printed figure: 45000 → "45,000".
 *
 * Fractions show only when they exist, so whole amounts stay uncluttered.
 */
export function formatMoney(
  amount: number | string | null | undefined,
  code: string = "PKR",
): string {
  const n = toNumber(amount);
  if (n == null) return "";
  const hasFraction = Math.round(n * 100) % 100 !== 0;
  return n.toLocaleString(currency(code).locale, {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

/** Always two decimal places — for table columns, where ragged decimals read badly. */
export function formatMoneyFixed(
  amount: number | string | null | undefined,
  code: string = "PKR",
): string {
  const n = toNumber(amount);
  if (n == null) return "";
  return n.toLocaleString(currency(code).locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Quantities: up to three decimals, never padded. 2 → "2", 2.5 → "2.5". */
export function formatQty(n: number | string | null | undefined): string {
  const v = toNumber(n);
  if (v == null) return "";
  return v.toLocaleString("en-US", { maximumFractionDigits: 3 });
}
