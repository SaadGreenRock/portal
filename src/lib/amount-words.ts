/**
 * The voucher's PKR wording, kept as its own two functions because that is what
 * the voucher template and screens call.
 *
 *   45000      → "Forty-Five Thousand Rupees Only"
 *   1250000    → "Twelve Lakh Fifty Thousand Rupees Only"
 *   1500.50    → "One Thousand Five Hundred Rupees and Fifty Paisa Only"
 *
 * The engine itself lives in money.ts, so purchase orders raised in another
 * currency read correctly without a second implementation drifting out of step.
 */

import { amountToWords, formatMoney } from "./money";

export function amountInWords(amount: number | string | null | undefined): string {
  return amountToWords(amount, "PKR");
}

export function formatAmount(amount: number | string | null | undefined): string {
  return formatMoney(amount, "PKR");
}
