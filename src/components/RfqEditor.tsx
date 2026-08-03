"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CURRENCY_LIST } from "@/lib/money";
import type { SavedRfq } from "@/lib/rfq/actions";
import { MAX_RFQ_ITEMS } from "@/lib/rfq/parse";
import {
  emptyRfqItem,
  newRfqRowId,
  type RfqDoc,
  type RfqItem,
  type RfqStatus,
} from "@/lib/rfq/types";
import { useSheetPdf } from "@/lib/use-sheet-pdf";
import { SheetStack, usePagesPreview } from "./SheetPreview";

/**
 * The request-for-quotation editor — used for both creating and editing.
 *
 * Deliberately close to the purchase order editor in shape, since an operator
 * moving between the two should not have to learn a second set of habits. What
 * is missing is the point of the document: there are no prices here, because the
 * vendor supplies those. Nothing on this screen adds up to a total.
 */

interface Props {
  company: string;
  /** Null until the request has been saved and given its number. */
  rfqNo: string | null;
  status: RfqStatus;
  initialDoc: RfqDoc;
  initialNote: string;
  mode: "create" | "edit";
  save: (payload: { doc: RfqDoc; internalNote: string; send?: boolean }) => Promise<SavedRfq>;
}

export default function RfqEditor({
  company,
  rfqNo,
  status,
  initialDoc,
  initialNote,
  mode,
  save,
}: Props) {
  const [doc, setDoc] = useState<RfqDoc>(initialDoc);
  const [note, setNote] = useState(initialNote);
  const [saving, setSaving] = useState(false);
  /** Which button started the save, so progress text lands on that one. */
  const [intent, setIntent] = useState<"draft" | "send" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  const pdf = useSheetPdf();
  const busy = saving || pdf.busy;

  const { pages, busy: previewBusy, rejected } = usePagesPreview(
    { company, doc, rfqNo, status },
    500,
    "/api/rfq/preview",
  );
  // Refuse locally for the same reason the server would, so the save button
  // never invites a press that cannot succeed.
  const blocked = Boolean(rejected);

  /**
   * Quantity as typed. The document stores a number, and an input bound straight
   * to one cannot hold "1." long enough to type "1.5".
   */
  const [raw, setRaw] = useState<Record<string, string>>({});
  const shown = (key: string, value: number) => raw[key] ?? (value ? String(value) : "");
  const typeNumber = (key: string, text: string, apply: (n: number) => void) => {
    const cleaned = text.replace(/[^\d.]/g, "").replace(/(\..*?)\./g, "$1");
    setRaw((r) => ({ ...r, [key]: cleaned }));
    apply(Number(cleaned) || 0);
  };
  const settle = (key: string) =>
    setRaw((r) => {
      const next = { ...r };
      delete next[key];
      return next;
    });

  const set = <K extends keyof RfqDoc>(key: K, value: RfqDoc[K]) =>
    setDoc((d) => ({ ...d, [key]: value }));

  const setItem = (id: string, patch: Partial<RfqItem>) =>
    setDoc((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));

  const atItemLimit = doc.items.length >= MAX_RFQ_ITEMS;

  const addItem = () =>
    setDoc((d) =>
      d.items.length >= MAX_RFQ_ITEMS ? d : { ...d, items: [...d.items, emptyRfqItem()] },
    );

  const removeItem = (id: string) =>
    setDoc((d) => {
      const items = d.items.filter((i) => i.id !== id);
      // Never leave the table with no rows — an empty editor reads as broken.
      return { ...d, items: items.length ? items : [emptyRfqItem()] };
    });

  const duplicateItem = (id: string) =>
    setDoc((d) => {
      const at = d.items.findIndex((i) => i.id === id);
      if (at < 0) return d;
      const items = [...d.items];
      items.splice(at + 1, 0, { ...d.items[at], id: newRfqRowId() });
      return { ...d, items };
    });

  const moveItem = (id: string, by: -1 | 1) =>
    setDoc((d) => {
      const at = d.items.findIndex((i) => i.id === id);
      const to = at + by;
      if (at < 0 || to < 0 || to >= d.items.length) return d;
      const items = [...d.items];
      [items[at], items[to]] = [items[to], items[at]];
      return { ...d, items };
    });

  /**
   * Save, then render. Two steps, as with the other documents: the server
   * assigns the number, then this browser rasterises the pages and posts the PDF
   * back. If the render fails the request still exists and its page offers a
   * retry, so we navigate either way rather than losing the operator's work.
   */
  async function submit(send: boolean) {
    setFailure(null);
    setIntent(send ? "send" : "draft");
    setSaving(true);

    let saved: SavedRfq;
    try {
      saved = await save({ doc, internalNote: note, send });
    } catch (e) {
      setSaving(false);
      setIntent(null);
      const message = e instanceof Error ? e.message : "";
      setFailure(
        message && !/NEXT_REDIRECT|fetch failed|load failed/i.test(message)
          ? message
          : "Could not save the request. Check your connection and try again.",
      );
      return;
    }
    setSaving(false);

    const rendered = await pdf.tryBuild({
      sheetUrl: `/api/rfq/${saved.id}/sheet`,
      pdfUrl: `/api/rfq/${saved.id}/pdf`,
      title: saved.rfqNo,
    });

    router.push(
      `/${saved.company}/rfq/${saved.id}?saved=${mode === "create" ? "new" : "1"}${
        rendered ? "" : "&pdf=failed"
      }`,
    );
  }

  // ⌘/Ctrl+Enter saves, so a fast operator never has to reach for the mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && !blocked) void submit(false);
      }}
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:items-start"
    >
      <div className="space-y-5">
        {/* ---- what and when --------------------------------------------- */}
        <section className="card overflow-hidden">
          <header className="border-b border-ink-line px-5 py-4">
            <h2 className="text-[15px] font-semibold">What you are asking for</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-soft">
              No vendor here — one request, which you send to whoever you like.
            </p>
          </header>

          <div className="space-y-3.5 p-5">
            <Field label="Subject" hint="One line. Prints as “We invite your quotation for…”.">
              <input
                value={doc.subject}
                onChange={(e) => set("subject", e.target.value)}
                placeholder="Workstations and monitors for the design team"
                className="input"
              />
            </Field>

            <div className="grid gap-3.5 sm:grid-cols-3">
              <Field label="Request date">
                <input
                  type="date"
                  value={doc.rfqDate}
                  onChange={(e) => set("rfqDate", e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Quotations due by" hint="Optional.">
                <input
                  type="date"
                  value={doc.replyBy}
                  onChange={(e) => set("replyBy", e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Quote in" hint="Currency vendors use.">
                <select
                  value={doc.currency}
                  onChange={(e) => set("currency", e.target.value)}
                  className="input"
                >
                  {CURRENCY_LIST.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field
              label="Delivery location"
              hint="Vendors need it to price freight. Prints on the request."
            >
              <textarea
                value={doc.deliveryAddress}
                onChange={(e) => set("deliveryAddress", e.target.value)}
                rows={2}
                placeholder="Green Rock Head Office, 2nd Floor, Business Centre, Lahore"
                className="input resize-y"
              />
            </Field>
          </div>
        </section>

        {/* ---- items ------------------------------------------------------ */}
        <section className="card overflow-hidden">
          <header className="flex items-baseline justify-between gap-3 border-b border-ink-line px-5 py-4">
            <div>
              <h2 className="text-[15px] font-semibold">Items to be quoted</h2>
              <p className="mt-0.5 text-[12.5px] text-ink-soft">
                Description, quantity and unit. Prices are left blank for the vendor.
              </p>
            </div>
            <span className="mono shrink-0 text-[12px] text-ink-soft">
              {doc.items.length} {doc.items.length === 1 ? "line" : "lines"}
            </span>
          </header>

          <ul className="divide-y divide-ink-line">
            {doc.items.map((item, index) => (
              <li key={item.id} className="p-4 sm:px-5">
                <div className="flex items-start gap-3">
                  <span className="mono mt-2.5 w-5 shrink-0 text-right text-[12.5px] text-ink-soft">
                    {index + 1}
                  </span>

                  <div className="min-w-0 flex-1 space-y-2.5">
                    <textarea
                      value={item.description}
                      onChange={(e) => setItem(item.id, { description: e.target.value })}
                      rows={2}
                      placeholder="MacBook Pro 14-inch, M4 Pro, 24GB / 1TB — or equivalent"
                      className="input resize-y"
                      aria-label={`Line ${index + 1} description`}
                    />

                    <div className="grid grid-cols-3 gap-2">
                      <input
                        value={item.code}
                        onChange={(e) => setItem(item.id, { code: e.target.value })}
                        placeholder="Item code"
                        className="input py-2 text-[13.5px]"
                        aria-label={`Line ${index + 1} item code`}
                      />
                      <input
                        value={shown(`${item.id}:qty`, item.qty)}
                        onChange={(e) =>
                          typeNumber(`${item.id}:qty`, e.target.value, (n) =>
                            setItem(item.id, { qty: n }),
                          )
                        }
                        onBlur={() => settle(`${item.id}:qty`)}
                        inputMode="decimal"
                        placeholder="Qty"
                        className="input py-2 text-right text-[13.5px]"
                        aria-label={`Line ${index + 1} quantity`}
                      />
                      <input
                        value={item.unit}
                        onChange={(e) => setItem(item.id, { unit: e.target.value })}
                        placeholder="Unit"
                        list="rfq-units"
                        className="input py-2 text-center text-[13.5px]"
                        aria-label={`Line ${index + 1} unit`}
                      />
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col gap-1">
                    <RowButton
                      label={`Move line ${index + 1} up`}
                      disabled={index === 0}
                      onClick={() => moveItem(item.id, -1)}
                    >
                      ↑
                    </RowButton>
                    <RowButton
                      label={`Move line ${index + 1} down`}
                      disabled={index === doc.items.length - 1}
                      onClick={() => moveItem(item.id, 1)}
                    >
                      ↓
                    </RowButton>
                    <RowButton
                      label={`Duplicate line ${index + 1}`}
                      onClick={() => duplicateItem(item.id)}
                    >
                      ⧉
                    </RowButton>
                    <RowButton
                      label={`Remove line ${index + 1}`}
                      danger
                      onClick={() => removeItem(item.id)}
                    >
                      ✕
                    </RowButton>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <datalist id="rfq-units">
            {["pcs", "nos", "set", "kg", "ton", "bag", "bundle", "ft", "m", "sq ft", "litre", "lot"].map(
              (u) => (
                <option key={u} value={u} />
              ),
            )}
          </datalist>

          <div className="flex flex-wrap items-center gap-3 border-t border-ink-line px-5 py-3.5">
            <button type="button" onClick={addItem} disabled={atItemLimit} className="btn btn-ghost">
              + Add line
            </button>
            {atItemLimit ? (
              <span className="text-[12.5px] text-ink-soft">
                {MAX_RFQ_ITEMS} lines is the limit for one request — split it into two.
              </span>
            ) : null}
          </div>
        </section>

        {/* ---- reply-to, notes, terms ------------------------------------- */}
        <section className="card overflow-hidden">
          <header className="border-b border-ink-line px-5 py-4">
            <h2 className="text-[15px] font-semibold">Where to send the quotation</h2>
          </header>

          <div className="space-y-3.5 p-5">
            <div className="grid gap-3.5 sm:grid-cols-3">
              <Field label="Contact name">
                <input
                  value={doc.contactName}
                  onChange={(e) => set("contactName", e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Email">
                <input
                  value={doc.contactEmail}
                  onChange={(e) => set("contactEmail", e.target.value)}
                  inputMode="email"
                  className="input"
                />
              </Field>
              <Field label="Phone">
                <input
                  value={doc.contactPhone}
                  onChange={(e) => set("contactPhone", e.target.value)}
                  inputMode="tel"
                  className="input"
                />
              </Field>
            </div>

            <Field label="Notes" hint="Printed under the table.">
              <textarea
                value={doc.notes}
                onChange={(e) => set("notes", e.target.value)}
                rows={3}
                placeholder="Partial quotations are acceptable. State lead time for each item."
                className="input resize-y"
              />
            </Field>

            <Field
              label="Conditions of quoting"
              hint="Comes from Settings. Edit here for this request only."
            >
              <textarea
                value={doc.terms}
                onChange={(e) => set("terms", e.target.value)}
                rows={5}
                className="input resize-y text-[13px]"
              />
            </Field>

            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label="Requested by">
                <input
                  value={doc.preparedBy}
                  onChange={(e) => set("preparedBy", e.target.value)}
                  className="input"
                />
              </Field>
              <Field
                label="Internal note"
                hint="Private. Searchable. Never printed."
              >
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. comparing three vendors before the Q4 refresh"
                  className="input"
                />
              </Field>
            </div>
          </div>
        </section>
      </div>

      {/* ---- preview + submit -------------------------------------------- */}
      <aside className="lg:sticky lg:top-5">
        <div className="mb-2.5 flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold">Preview</h2>
          <span className="text-[12px] text-ink-soft">Exactly what prints</span>
        </div>

        <SheetStack pages={pages} busy={previewBusy} />

        {rejected ? (
          <p
            role="alert"
            className="mt-2.5 rounded-lg bg-amber-50 px-3 py-2.5 text-[12.5px] font-medium leading-snug text-amber-900"
          >
            {rejected} The preview above is the last version that fitted.
          </p>
        ) : null}

        <div className="mt-4 space-y-2">
          {mode === "create" ? (
            <>
              <button
                type="button"
                disabled={busy || blocked}
                onClick={() => void submit(true)}
                className="btn btn-primary w-full py-3"
              >
                {intent === "send" && saving
                  ? "Assigning number…"
                  : intent === "send"
                    ? pdf.statusLabel("Create & mark as sent")
                    : "Create & mark as sent"}
              </button>
              <button type="submit" disabled={busy || blocked} className="btn btn-ghost w-full py-2.5">
                {intent === "draft" && saving
                  ? "Assigning number…"
                  : intent === "draft"
                    ? pdf.statusLabel("Save as draft")
                    : "Save as draft"}
              </button>
            </>
          ) : (
            <button type="submit" disabled={busy || blocked} className="btn btn-primary w-full py-3">
              {saving ? "Saving…" : pdf.statusLabel("Save changes")}
            </button>
          )}
        </div>

        {failure || pdf.error ? (
          <p role="alert" className="mt-2 text-center text-[12.5px] font-medium text-red-700">
            {failure ?? pdf.error}
          </p>
        ) : (
          <p className="mt-2 text-center text-[12px] text-ink-soft">
            {mode === "create"
              ? "Assigns the next request number and renders the PDF."
              : "Re-renders the PDF from the saved document."}{" "}
            <kbd className="font-sans font-medium">⌘</kbd>
            <kbd className="font-sans font-medium">↵</kbd>
          </p>
        )}
      </aside>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {hint ? <span className="mt-0.5 block text-[12px] text-ink-soft">{hint}</span> : null}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

function RowButton({
  children,
  label,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`grid h-6 w-6 place-items-center rounded text-[12px] leading-none transition-colors disabled:opacity-25 ${
        danger
          ? "text-ink-soft hover:bg-red-50 hover:text-red-700"
          : "text-ink-soft hover:bg-[#efefec] hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
