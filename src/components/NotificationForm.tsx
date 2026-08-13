"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { CARD } from "@/lib/notifications/geometry";
import {
  BODY_MAX,
  emptyNotificationFields,
  HEADLINE_MAX,
  NOTIFICATION_TAGS,
  SENDER_MAX,
  TAG_LABELS,
  type NotificationFields,
} from "@/lib/notifications/types";
import { useNotificationRender } from "@/lib/notifications/use-notification-render";
import type { SavedNotification } from "@/lib/notifications/actions";
import SheetPreview, { usePreview } from "./SheetPreview";

interface Props {
  company: string;
  today: string;
  /** Server action: creates the record and returns its id. */
  action: (form: FormData) => Promise<SavedNotification>;
}

export default function NotificationForm({ company, today, action }: Props) {
  const [fields, setFields] = useState<NotificationFields>(() => emptyNotificationFields(today));
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  const { html, busy, rejected } = usePreview(company, fields, 350, "/api/notification/preview");
  const render = useNotificationRender();

  const [creating, setCreating] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const submitting = creating || render.busy;
  const blocked = Boolean(rejected) || !fields.headline.trim() || !fields.body.trim();

  const set = <K extends keyof NotificationFields>(key: K, value: NotificationFields[K]) =>
    setFields((f) => ({ ...f, [key]: value }));

  async function submit(formData: FormData) {
    setFailure(null);
    setCreating(true);
    let created: SavedNotification;
    try {
      created = await action(formData);
    } catch (e) {
      setCreating(false);
      setFailure(e instanceof Error ? e.message : "Could not save the notification. Try again.");
      return;
    }
    setCreating(false);

    // Navigate either way: the notification and its number already exist, so
    // losing the render is recoverable but losing the operator's place is not.
    const rendered = await render.tryBuild(created.id);
    router.push(
      `/${created.company}/notifications/${created.id}?new=1${rendered ? "" : "&render=failed"}`,
    );
  }

  return (
    <form
      ref={formRef}
      action={submit}
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)] lg:items-start"
    >
      <div className="space-y-5">
        <section className="card p-5">
          <label htmlFor="headline" className="label flex items-baseline justify-between">
            <span>Headline</span>
            <span className="mono text-[11px] text-ink-soft">
              {fields.headline.length}/{HEADLINE_MAX}
            </span>
          </label>
          <input
            id="headline"
            name="headline"
            value={fields.headline}
            onChange={(e) => set("headline", e.target.value.slice(0, HEADLINE_MAX))}
            placeholder="Office closed for Eid holidays"
            autoFocus
            className="input mt-2"
          />
        </section>

        <section className="card p-5">
          <label htmlFor="body" className="label flex items-baseline justify-between">
            <span>Message</span>
            <span className="mono text-[11px] text-ink-soft">
              {fields.body.length}/{BODY_MAX}
            </span>
          </label>
          <textarea
            id="body"
            name="body"
            value={fields.body}
            onChange={(e) => set("body", e.target.value.slice(0, BODY_MAX))}
            rows={6}
            placeholder="The office will remain closed from 17–19 June for Eid holidays. Normal operations resume 20 June."
            className="input mt-2 resize-y"
          />
          <p className="mt-1.5 text-[12.5px] leading-snug text-ink-soft">
            Keep it short — this is a card, not a document. Longer text shrinks to fit.
          </p>
        </section>

        <section className="card p-5">
          <label htmlFor="tag" className="label">
            Tag
          </label>
          <select
            id="tag"
            name="tag"
            value={fields.tag}
            onChange={(e) => set("tag", e.target.value as NotificationFields["tag"])}
            className="input mt-2"
          >
            {NOTIFICATION_TAGS.map((tag) => (
              <option key={tag} value={tag}>
                {TAG_LABELS[tag]}
              </option>
            ))}
          </select>
        </section>

        <div className="grid gap-5 sm:grid-cols-2">
          <section className="card p-5">
            <label htmlFor="sender" className="label flex items-baseline justify-between">
              <span>Sender</span>
              <span className="mono text-[11px] text-ink-soft">
                {fields.sender.length}/{SENDER_MAX}
              </span>
            </label>
            <input
              id="sender"
              name="sender"
              value={fields.sender}
              onChange={(e) => set("sender", e.target.value.slice(0, SENDER_MAX))}
              placeholder="Management"
              className="input mt-2"
            />
          </section>

          <section className="card p-5">
            <label htmlFor="notifyDate" className="label">
              Date
            </label>
            <input
              id="notifyDate"
              name="notifyDate"
              type="date"
              value={fields.notifyDate}
              onChange={(e) => set("notifyDate", e.target.value)}
              className="input mt-2"
            />
          </section>
        </div>
      </div>

      {/* ---- preview + submit ------------------------------------------ */}
      <aside className="lg:sticky lg:top-5">
        <div className="mb-2.5 flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold">Preview</h2>
          <span className="text-[12px] text-ink-soft">The card, exactly as sent</span>
        </div>

        <div className="mx-auto max-w-[280px]">
          <SheetPreview html={html} busy={busy} width={CARD.widthPx} height={CARD.heightPx} />
        </div>

        <button
          type="submit"
          disabled={submitting || blocked}
          className="btn btn-primary mt-4 w-full py-3"
        >
          {creating
            ? "Assigning number…"
            : render.stage === "rendering"
              ? "Rendering…"
              : render.stage === "uploading"
                ? "Saving…"
                : "Generate notification"}
        </button>

        {failure ? (
          <p role="alert" className="mt-2 text-center text-[12.5px] font-medium text-red-700">
            {failure}
          </p>
        ) : rejected ? (
          <p role="alert" className="mt-2 text-center text-[12.5px] font-medium text-red-700">
            {rejected}
          </p>
        ) : (
          <p className="mt-2 text-center text-[12px] text-ink-soft">
            Produces a PNG for WhatsApp and a PDF for email, together.
          </p>
        )}
      </aside>
    </form>
  );
}
