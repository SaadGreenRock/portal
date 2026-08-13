import {
  BODY_MAX,
  HEADLINE_MAX,
  NOTIFICATION_TAGS,
  SENDER_MAX,
  type NotificationFields,
  type NotificationTag,
} from "./types";

/**
 * Turning an untrusted compose payload into fields we can render and store.
 *
 * Deliberately not in actions.ts: every exported async function in a
 * "use server" module becomes a publicly callable endpoint, and this is also
 * needed by the preview route, which is not an action. Both intake paths — the
 * live preview's JSON body and the save action's FormData — funnel through
 * this one validator, so the same caps apply live and on save.
 *
 * Text is *refused* past its limit rather than truncated: silently cutting a
 * headline in half loses something a person typed with no way for them to
 * notice, which for a records system is the worst failure available.
 */
function text(v: unknown, max: number, field: string, required = false): string {
  const trimmed = typeof v === "string" ? v.trim() : "";
  if (trimmed.length > max) {
    throw new Error(`${field} is too long: ${trimmed.length} characters, and the limit is ${max}.`);
  }
  if (required && !trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

/** yyyy-mm-dd, or "" — anything else would print as garbage on the card. */
const isoDate = (v: unknown): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
};

export function readNotificationFields(input: unknown): NotificationFields {
  const b = (input ?? {}) as Record<string, unknown>;
  const tag = b.tag;

  return {
    headline: text(b.headline, HEADLINE_MAX, "Headline", true),
    body: text(b.body, BODY_MAX, "Message", true),
    tag: NOTIFICATION_TAGS.includes(tag as NotificationTag) ? (tag as NotificationTag) : "notice",
    sender: text(b.sender, SENDER_MAX, "Sender") || "Management",
    notifyDate: isoDate(b.notifyDate),
  };
}
