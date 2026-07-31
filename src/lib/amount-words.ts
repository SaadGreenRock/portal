/**
 * Rupee amounts written out in words, using the South Asian numbering system
 * (thousand → lakh → crore → arab), which is what a PKR voucher reader expects.
 *
 *   45000      → "Forty-Five Thousand Rupees Only"
 *   1250000    → "Twelve Lakh Fifty Thousand Rupees Only"
 *   1500.50    → "One Thousand Five Hundred Rupees and Fifty Paisa Only"
 */

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
 * A whole number in South Asian groupings. Handles up to 99,99,99,99,999
 * (just under ten thousand crore) — far beyond any voucher.
 */
function wholeNumberToWords(n: number): string {
  if (n === 0) return "Zero";

  const groups: Array<[number, string]> = [
    [1_00_00_00_000, "Arab"],
    [1_00_00_000, "Crore"],
    [1_00_000, "Lakh"],
    [1_000, "Thousand"],
  ];

  const parts: string[] = [];
  let remaining = n;

  for (const [value, label] of groups) {
    const count = Math.floor(remaining / value);
    if (count > 0) {
      // Group counts are themselves at most 3 digits at this scale.
      parts.push(`${threeDigits(count)} ${label}`);
      remaining %= value;
    }
  }

  if (remaining > 0) parts.push(threeDigits(remaining));
  return parts.join(" ");
}

/**
 * Full voucher phrasing, including the "Rupees … Only" wrapper.
 * Returns an empty string for input that isn't a usable positive amount, so
 * callers can simply leave the line blank.
 */
export function amountInWords(amount: number | string | null | undefined): string {
  const n = typeof amount === "string" ? Number(amount.replace(/,/g, "").trim()) : amount;
  if (n == null || !Number.isFinite(n) || n <= 0) return "";

  // Round to paisa before splitting, so 1500.499 doesn't become 49 paisa.
  const totalPaisa = Math.round(n * 100);
  const rupees = Math.floor(totalPaisa / 100);
  const paisa = totalPaisa % 100;

  const parts: string[] = [];
  if (rupees > 0) parts.push(`${wholeNumberToWords(rupees)} Rupees`);
  if (paisa > 0) {
    parts.push(`${rupees > 0 ? "and " : ""}${twoDigits(paisa)} Paisa`);
  }

  return `${parts.join(" ")} Only`;
}

/** Thousands separators for the printed figure: 45000 → "45,000". */
export function formatAmount(amount: number | string | null | undefined): string {
  const n = typeof amount === "string" ? Number(amount.replace(/,/g, "").trim()) : amount;
  if (n == null || !Number.isFinite(n)) return "";
  // Voucher figures show paisa only when they exist.
  const hasPaisa = Math.round(n * 100) % 100 !== 0;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: hasPaisa ? 2 : 0,
    maximumFractionDigits: 2,
  });
}
