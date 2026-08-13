import type { CompanySlug } from "../companies";

/**
 * Branded announcement cards — a short, company-wide notice rendered as a PNG
 * (for WhatsApp) and a PDF (for email), both from the same template.
 *
 * Flat fields throughout, no jsonb doc: every field here is either printed on
 * the card or filtered/searched on in History, the same reasoning assets and
 * food entries use — a doc column would only add indirection.
 *
 * Not a document with a lifecycle. Compose → save → render → done: there is no
 * edit and no approval step, so this module carries none of the status
 * machinery vouchers/PO/RFQ have.
 */

export type NotificationTag = "notice" | "announcement" | "action-required" | "urgent";

export const NOTIFICATION_TAGS: NotificationTag[] = [
  "notice",
  "announcement",
  "action-required",
  "urgent",
];

export const TAG_LABELS: Record<NotificationTag, string> = {
  notice: "Notice",
  announcement: "Announcement",
  "action-required": "Action required",
  urgent: "Urgent",
};

export function isNotificationTag(v: unknown): v is NotificationTag {
  return typeof v === "string" && (NOTIFICATION_TAGS as string[]).includes(v);
}

/** Firm caps — this is a short card, not a document, and a longer text would
 *  either overflow the fixed-height layout or shrink past legibility. */
export const HEADLINE_MAX = 80;
export const BODY_MAX = 500;
export const SENDER_MAX = 60;

/** What the operator types. */
export interface NotificationFields {
  headline: string;
  body: string;
  tag: NotificationTag;
  /** Free text — "Management" by default. Not the vouchers signatories table:
   *  that list is scoped to signed-payment authorization, a different concept. */
  sender: string;
  /** ISO date (yyyy-mm-dd) printed on the card — not necessarily today. */
  notifyDate: string;
}

export interface Notification extends NotificationFields {
  id: string;
  /** `GR-NOTE-202608-001` — same numbering machinery every other module uses. */
  notifNo: string;
  company: CompanySlug;
  seq: number;
  period: string;
  createdAt: string;
  /** Storage keys, resolved through /api/file/<key>. Null until rendered. */
  pngKey: string | null;
  pngAt: string | null;
  pdfKey: string | null;
  pdfAt: string | null;
  /** Same reasoning as every other module: the row stays, so its number stays
   *  spent, and a mistaken compose can be undone. */
  deletedAt: string | null;
}

export interface NotificationQuery {
  company: CompanySlug;
  /** Free text across notif no., headline, body and sender. */
  q?: string;
  /** "deleted" is the recycle-bin view; everything else hides deleted rows. */
  status?: "all" | "deleted";
  tag?: NotificationTag | "all";
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface NotificationCounts {
  total: number;
}

export function emptyNotificationFields(today: string): NotificationFields {
  return { headline: "", body: "", tag: "notice", sender: "", notifyDate: today };
}
