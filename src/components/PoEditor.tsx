"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CURRENCY_LIST, amountToWords, formatMoneyFixed } from "@/lib/money";
import type { SavedPo } from "@/lib/po/actions";
import { lineAmount, poTotals } from "@/lib/po/totals";
import {
  emptyItem,
  newRowId,
  type PoDoc,
  type PoItem,
  type PoStatus,
  type PoVendor,
  type VendorProfile,
} from "@/lib/po/types";
import { useSheetPdf } from "@/lib/use-sheet-pdf";
import { SheetStack, usePagesPreview } from "./SheetPreview";

/**
 * The purchase order editor — used for both creating and editing.
 *
 * One component for both, because a PO stays editable after it is issued: if
 * the two screens were separate they would drift, and an operator correcting a
 * quantity would meet a different form from the one they typed it into.
 *
 * The whole document is posted as one JSON payload rather than as named form
 * fields. A PO has a variable number of line items, and rebuilding a repeating
 * group out of FormData is exactly the kind of index-juggling that silently
 * drops a row.
 */

interface Props {
  company: string;
  /** Null until the order has been saved and given its number. */
  poNo: string | null;
  status: PoStatus;
  initialDoc: PoDoc;
  initialNote: string;
  vendors: VendorProfile[];
  mode: "create" | "edit";
  save: (payload: {
    doc: PoDoc;
    internalNote: string;
    issue?: boolean;
  }) => Promise<SavedPo>;
}

export default function PoEditor({
  company,
  poNo,
  status,
  initialDoc,
  initialNote,
  vendors,
  mode,
  save,
}: Props) {
  const [doc, setDoc] = useState<PoDoc>(initialDoc);
  const [note, setNote] = useState(initialNote);
  const [saving, setSaving] = useState(false);
  /** Which button started the save, so the progress text appears on that one. */
  const [intent, setIntent] = useState<"draft" | "issue" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  const pdf = useSheetPdf();
  const busy = saving || pdf.busy;

  const { pages, busy: previewBusy } = usePagesPreview({ company, doc, poNo, status });
  const totals = useMemo(() => poTotals(doc), [doc]);

  /**
   * Text as typed, for the numeric fields.
   *
   * The document stores numbers, but an input bound straight to a number can't
   * hold "1." or "0.0" long enough to type "1.05" — the parse-and-reformat
   * round trip eats the decimal point. This keeps the raw string until the
   * field is left, and the number stays authoritative for the maths.
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

  const set = <K extends keyof PoDoc>(key: K, value: PoDoc[K]) =>
    setDoc((d) => ({ ...d, [key]: value }));

  const setVendor = (patch: Partial<PoVendor>) =>
    setDoc((d) => ({ ...d, vendor: { ...d.vendor, ...patch } }));

  const setItem = (id: string, patch: Partial<PoItem>) =>
    setDoc((d) => ({
      ...d,
      items: d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    }));

  const addItem = () => setDoc((d) => ({ ...d, items: [...d.items, emptyItem()] }));

  const removeItem = (id: string) =>
    setDoc((d) => {
      const items = d.items.filter((i) => i.id !== id);
      // Never leave the table with no rows at all — an empty editor reads as broken.
      return { ...d, items: items.length ? items : [emptyItem()] };
    });

  const duplicateItem = (id: string) =>
    setDoc((d) => {
      const at = d.items.findIndex((i) => i.id === id);
      if (at < 0) return d;
      const copy: PoItem = { ...d.items[at], id: newRowId() };
      const items = [...d.items];
      items.splice(at + 1, 0, copy);
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
   * Save, then render. Two steps, as with vouchers: the server assigns the
   * number, then this browser rasterises the pages and posts the PDF back. If
   * the render fails the order still exists and its page offers a retry, so we
   * navigate either way rather than losing the operator's work.
   */
  async function submit(issue: boolean) {
    setFailure(null);
    setIntent(issue ? "issue" : "draft");
    setSaving(true);

    let saved: SavedPo;
    try {
      saved = await save({ doc, internalNote: note, issue });
    } catch {
      setSaving(false);
      setIntent(null);
      setFailure("Could not save the purchase order. Check your connection and try again.");
      return;
    }
    setSaving(false);

    const rendered = await pdf.tryBuild({
      sheetUrl: `/api/po/${saved.id}/sheet`,
      pdfUrl: `/api/po/${saved.id}/pdf`,
      title: saved.poNo,
    });

    router.push(
      `/${saved.company}/po/${saved.id}?saved=${mode === "create" ? "new" : "1"}${
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

  const code = doc.currency;
  const words = totals.total > 0 ? amountToWords(totals.total, code) : "";

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void submit(false);
      }}
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:items-start"
    >
      <div className="space-y-5">
        {/* ---- vendor ---------------------------------------------------- */}
        <section className="card overflow-hidden">
          <header className="border-b border-ink-line px-5 py-4">
            <h2 className="text-[15px] font-semibold">Vendor</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-soft">
              Start typing a name you have ordered from before and the rest fills itself in.
            </p>
          </header>

          <div className="space-y-3.5 p-5">
            <VendorPicker
              value={doc.vendor.name}
              vendors={vendors}
              onName={(name) => setVendor({ name })}
              onPick={(v) =>
                setVendor({
                  name: v.name,
                  address: v.address,
                  contact: v.contact,
                  phone: v.phone,
                  email: v.email,
                  taxId: v.taxId,
                })
              }
            />

            <Field label="Address">
              <textarea
                value={doc.vendor.address}
                onChange={(e) => setVendor({ address: e.target.value })}
                rows={2}
                placeholder="123 Industrial Area, Lahore"
                className="input resize-y"
              />
            </Field>

            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label="Contact person">
                <input
                  value={doc.vendor.contact}
                  onChange={(e) => setVendor({ contact: e.target.value })}
                  placeholder="Mr. Bilal Ahmed"
                  className="input"
                />
              </Field>
              <Field label="Phone">
                <input
                  value={doc.vendor.phone}
                  onChange={(e) => setVendor({ phone: e.target.value })}
                  inputMode="tel"
                  placeholder="0300-1234567"
                  className="input"
                />
              </Field>
              <Field label="Email">
                <input
                  value={doc.vendor.email}
                  onChange={(e) => setVendor({ email: e.target.value })}
                  inputMode="email"
                  placeholder="sales@vendor.com"
                  className="input"
                />
              </Field>
              <Field label="Tax registration no.">
                <input
                  value={doc.vendor.taxId}
                  onChange={(e) => setVendor({ taxId: e.target.value })}
                  placeholder="NTN 1234567-8"
                  className="input"
                />
              </Field>
            </div>
          </div>
        </section>

        {/* ---- order details --------------------------------------------- */}
        <section className="card overflow-hidden">
          <header className="border-b border-ink-line px-5 py-4">
            <h2 className="text-[15px] font-semibold">Order details</h2>
          </header>

          <div className="space-y-3.5 p-5">
            <Field label="Subject" hint="One line describing the order. Prints under the addresses.">
              <input
                value={doc.subject}
                onChange={(e) => set("subject", e.target.value)}
                placeholder="Cement and steel for Plot 14 foundation"
                className="input"
              />
            </Field>

            <div className="grid gap-3.5 sm:grid-cols-3">
              <Field label="PO date">
                <input
                  type="date"
                  value={doc.poDate}
                  onChange={(e) => set("poDate", e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Required by" hint="Optional.">
                <input
                  type="date"
                  value={doc.deliveryDate}
                  onChange={(e) => set("deliveryDate", e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Reference" hint="Their quote no.">
                <input
                  value={doc.reference}
                  onChange={(e) => set("reference", e.target.value)}
                  placeholder="QT-2291"
                  className="input"
                />
              </Field>
            </div>

            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label="Payment terms">
                <input
                  value={doc.paymentTerms}
                  onChange={(e) => set("paymentTerms", e.target.value)}
                  placeholder="30 days from invoice"
                  className="input"
                />
              </Field>
              <Field label="Currency">
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

            <Field label="Deliver to" hint="Where the goods go. Prints as the Ship To block.">
              <textarea
                value={doc.deliveryAddress}
                onChange={(e) => set("deliveryAddress", e.target.value)}
                rows={2}
                placeholder="Site office, Plot 14, Sundar Industrial Estate, Lahore"
                className="input resize-y"
              />
            </Field>
          </div>
        </section>

        {/* ---- line items ------------------------------------------------ */}
        <section className="card overflow-hidden">
          <header className="flex items-baseline justify-between gap-3 border-b border-ink-line px-5 py-4">
            <h2 className="text-[15px] font-semibold">Line items</h2>
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
                      placeholder="Ordinary Portland cement, 50 kg bags, Grade 53"
                      className="input resize-y"
                      aria-label={`Line ${index + 1} description`}
                    />

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
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
                        list="po-units"
                        className="input py-2 text-center text-[13.5px]"
                        aria-label={`Line ${index + 1} unit`}
                      />
                      <input
                        value={shown(`${item.id}:rate`, item.unitPrice)}
                        onChange={(e) =>
                          typeNumber(`${item.id}:rate`, e.target.value, (n) =>
                            setItem(item.id, { unitPrice: n }),
                          )
                        }
                        onBlur={() => settle(`${item.id}:rate`)}
                        inputMode="decimal"
                        placeholder="Rate"
                        className="input py-2 text-right text-[13.5px]"
                        aria-label={`Line ${index + 1} unit price`}
                      />
                      <div className="mono flex items-center justify-end rounded-lg bg-[#f4f4f2] px-3 py-2 text-[13.5px] font-semibold">
                        {formatMoneyFixed(lineAmount(item), code)}
                      </div>
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

          {/* Common units, offered as suggestions rather than a fixed list —
              every trade counts in something different. */}
          <datalist id="po-units">
            {["pcs", "nos", "kg", "ton", "bag", "bundle", "ft", "m", "sq ft", "litre", "hour", "day", "lot"].map(
              (u) => (
                <option key={u} value={u} />
              ),
            )}
          </datalist>

          <div className="border-t border-ink-line px-5 py-3.5">
            <button type="button" onClick={addItem} className="btn btn-ghost">
              + Add line
            </button>
          </div>
        </section>

        {/* ---- totals ----------------------------------------------------- */}
        <section className="card overflow-hidden">
          <header className="border-b border-ink-line px-5 py-4">
            <h2 className="text-[15px] font-semibold">Tax and totals</h2>
          </header>

          <div className="grid gap-5 p-5 sm:grid-cols-2 sm:items-start">
            <div className="space-y-3.5">
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={doc.showTax}
                  onChange={(e) => set("showTax", e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                />
                <span className="text-[13.5px] leading-snug">
                  Charge tax on this order
                  <span className="block text-[12px] text-ink-soft">
                    Off removes the tax row from the document entirely.
                  </span>
                </span>
              </label>

              {doc.showTax ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Tax label">
                    <input
                      value={doc.taxLabel}
                      onChange={(e) => set("taxLabel", e.target.value)}
                      placeholder="GST"
                      className="input"
                    />
                  </Field>
                  <Field label="Rate %">
                    <input
                      value={shown("taxRate", doc.taxRate)}
                      onChange={(e) =>
                        typeNumber("taxRate", e.target.value, (n) =>
                          set("taxRate", Math.min(100, n)),
                        )
                      }
                      onBlur={() => settle("taxRate")}
                      inputMode="decimal"
                      className="input text-right"
                    />
                  </Field>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <Field label={`Discount (${code})`}>
                  <input
                    value={shown("discount", doc.discount)}
                    onChange={(e) =>
                      typeNumber("discount", e.target.value, (n) => set("discount", n))
                    }
                    onBlur={() => settle("discount")}
                    inputMode="decimal"
                    placeholder="0"
                    className="input text-right"
                  />
                </Field>
                <Field label={`Freight (${code})`}>
                  <input
                    value={shown("shipping", doc.shipping)}
                    onChange={(e) =>
                      typeNumber("shipping", e.target.value, (n) => set("shipping", n))
                    }
                    onBlur={() => settle("shipping")}
                    inputMode="decimal"
                    placeholder="0"
                    className="input text-right"
                  />
                </Field>
              </div>
            </div>

            <div className="rounded-xl bg-[#f7f7f5] p-4">
              <Total label="Subtotal" value={formatMoneyFixed(totals.subtotal, code)} />
              {totals.discount > 0 ? (
                <Total label="Discount" value={`− ${formatMoneyFixed(totals.discount, code)}`} />
              ) : null}
              {doc.showTax ? (
                <Total
                  label={`${doc.taxLabel || "Tax"} @ ${doc.taxRate}%`}
                  value={formatMoneyFixed(totals.tax, code)}
                />
              ) : null}
              {totals.shipping > 0 ? (
                <Total label="Freight" value={formatMoneyFixed(totals.shipping, code)} />
              ) : null}
              <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-ink-line pt-2.5">
                <span className="text-[13.5px] font-semibold">Total</span>
                <span className="mono text-[17px] font-bold">
                  {code} {formatMoneyFixed(totals.total, code)}
                </span>
              </div>
              {words ? (
                <p className="mt-2 text-[12px] leading-snug text-ink-soft">{words}</p>
              ) : null}
            </div>
          </div>
        </section>

        {/* ---- notes, terms, internal note -------------------------------- */}
        <section className="card overflow-hidden">
          <header className="border-b border-ink-line px-5 py-4">
            <h2 className="text-[15px] font-semibold">Notes and terms</h2>
          </header>

          <div className="space-y-3.5 p-5">
            <Field label="Notes" hint="Printed on the order, under the totals.">
              <textarea
                value={doc.notes}
                onChange={(e) => set("notes", e.target.value)}
                rows={3}
                placeholder="Deliver between 9am and 4pm. Call the site office one hour before arrival."
                className="input resize-y"
              />
            </Field>

            <Field
              label="Terms and conditions"
              hint="Comes from Settings. Edit here to change it for this order only."
            >
              <textarea
                value={doc.terms}
                onChange={(e) => set("terms", e.target.value)}
                rows={5}
                className="input resize-y text-[13px]"
              />
            </Field>

            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label="Prepared by">
                <input
                  value={doc.preparedBy}
                  onChange={(e) => set("preparedBy", e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Approved by">
                <input
                  value={doc.approvedBy}
                  onChange={(e) => set("approvedBy", e.target.value)}
                  className="input"
                />
              </Field>
            </div>

            <Field
              label="Internal note"
              hint="Private. Searchable in History. Never appears on the order."
            >
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. foundation materials — approved by Saad on call"
                className="input"
              />
            </Field>
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

        <div className="mt-4 space-y-2">
          {mode === "create" ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submit(true)}
                className="btn btn-primary w-full py-3"
              >
                {intent === "issue" && saving
                  ? "Assigning number…"
                  : intent === "issue"
                    ? pdf.statusLabel("Create & issue")
                    : "Create & issue"}
              </button>
              <button type="submit" disabled={busy} className="btn btn-ghost w-full py-2.5">
                {intent === "draft" && saving
                  ? "Assigning number…"
                  : intent === "draft"
                    ? pdf.statusLabel("Save as draft")
                    : "Save as draft"}
              </button>
            </>
          ) : (
            <button type="submit" disabled={busy} className="btn btn-primary w-full py-3">
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
              ? "Assigns the next PO number and renders the PDF."
              : "Re-renders the PDF from the saved document."}{" "}
            <kbd className="font-sans font-medium">⌘</kbd>
            <kbd className="font-sans font-medium">↵</kbd>
          </p>
        )}
      </aside>
    </form>
  );
}

/* -------------------------------------------------------------------------
 * Pieces
 * ---------------------------------------------------------------------------*/

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

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-[13px]">
      <span className="text-ink-soft">{label}</span>
      <span className="mono">{value}</span>
    </div>
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

/**
 * Vendor name with suggestions from previous orders.
 *
 * There is no vendor directory to maintain — the list is simply everyone
 * ordered from before. Picking one fills the address and contact fields from
 * the most recent order for that name; typing a new name is always allowed, and
 * that is how a vendor gets added.
 */
function VendorPicker({
  value,
  vendors,
  onName,
  onPick,
}: {
  value: string;
  vendors: VendorProfile[];
  onName: (name: string) => void;
  onPick: (vendor: VendorProfile) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    const pool = q ? vendors.filter((v) => v.name.toLowerCase().includes(q)) : vendors;
    // An exact match means the operator has already chosen; nothing left to offer.
    if (pool.length === 1 && pool[0].name.toLowerCase() === q) return [];
    return pool.slice(0, 8);
  }, [value, vendors]);

  // Close on a click anywhere else, the way a native picker behaves.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={box} className="relative">
      <label className="block">
        <span className="label">Vendor name</span>
        <input
          value={value}
          onChange={(e) => {
            onName(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          placeholder="Al-Karam Traders"
          autoComplete="off"
          className="input mt-1.5"
        />
      </label>

      {open && matches.length > 0 ? (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-ink-line bg-white py-1 shadow-lg">
          {matches.map((v) => (
            <li key={v.name}>
              <button
                type="button"
                onClick={() => {
                  onPick(v);
                  setOpen(false);
                }}
                className="flex w-full items-baseline justify-between gap-3 px-3.5 py-2 text-left hover:bg-[var(--accent-wash)]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{v.name}</span>
                  {v.address ? (
                    <span className="block truncate text-[12px] text-ink-soft">
                      {v.address.split("\n")[0]}
                    </span>
                  ) : null}
                </span>
                <span className="mono shrink-0 text-[11.5px] text-ink-soft">
                  {v.orders} {v.orders === 1 ? "order" : "orders"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
