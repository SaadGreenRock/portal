"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { amountInWords } from "@/lib/amount-words";
import { emptyFields, TOGGLE_LABELS, type ToggleKey, type VoucherFields } from "@/lib/types";
import SheetPreview, { usePreview } from "./SheetPreview";
import Toggle from "./Toggle";

interface Props {
  company: string;
  today: string;
  signatories: string[];
  /** Server action: takes the form payload and generates the voucher. */
  action: (form: FormData) => void;
}

/** Text under a toggle, spelling out what OFF actually means. */
const HINTS: Record<ToggleKey, string> = {
  description: "Printed on the voucher — phrase it presentably.",
  amount: "The figure and the words are both printed.",
  recipientName: "Also fills the recipient's signature line.",
  phone: "Recipient's contact number.",
  voucherDate: "Printed next to the voucher number.",
  authorizedName: "Chosen from the company's saved signatories.",
  authorizedDate: "Printed under the company signature.",
};

export default function GenerateForm({ company, today, signatories, action }: Props) {
  const [fields, setFields] = useState<VoucherFields>(() => emptyFields(today));
  const [internalNote, setInternalNote] = useState("");
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const { html, busy } = usePreview(company, fields);

  const setOn = (key: ToggleKey, value: boolean) =>
    setFields((f) => ({ ...f, on: { ...f.on, [key]: value } }));

  /**
   * Typing into a field the operator forgot to switch on is unambiguous intent,
   * so switch it on for them rather than silently discarding what they typed.
   * Switching it back off is always one click away.
   */
  const setValueAndEnable = (key: ToggleKey & keyof Omit<VoucherFields, "on">, value: string) =>
    setFields((f) => ({
      ...f,
      [key]: value,
      on: { ...f.on, [key]: value.trim() ? true : f.on[key] },
    }));

  // ⌘/Ctrl+Enter generates, so a fast operator never has to reach for the mouse.
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

  const words = fields.on.amount ? amountInWords(fields.amount) : "";
  const printedCount = (Object.keys(fields.on) as ToggleKey[]).filter((k) => fields.on[k]).length;

  return (
    <form
      ref={formRef}
      action={(formData) => startTransition(() => action(formData))}
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start"
    >
      {/* Every toggle and value is mirrored into hidden inputs, so the server
          action receives exactly the state the preview was rendered from. */}
      {(Object.keys(fields.on) as ToggleKey[]).map((k) =>
        fields.on[k] ? <input key={k} type="hidden" name={`on.${k}`} value="1" /> : null,
      )}
      <input type="hidden" name="voucherDate" value={fields.voucherDate} />
      <input type="hidden" name="authorizedDate" value={fields.authorizedDate} />

      <div className="space-y-5">
        {/* ---- internal note ------------------------------------------- */}
        <section className="card p-5">
          <label htmlFor="internalNote" className="label">
            Internal note
          </label>
          <p className="mt-1 text-[12.5px] text-ink-soft">
            Private. Searchable in History. Never appears on the voucher.
          </p>
          <input
            id="internalNote"
            name="internalNote"
            value={internalNote}
            onChange={(e) => setInternalNote(e.target.value)}
            placeholder="e.g. fence repair — Aslam, site 14"
            autoFocus
            className="input mt-2.5"
          />
        </section>

        {/* ---- printed fields ------------------------------------------ */}
        <section className="card overflow-hidden">
          <header className="flex items-baseline justify-between gap-3 border-b border-ink-line px-5 py-4">
            <div>
              <h2 className="text-[15px] font-semibold">Printed fields</h2>
              <p className="mt-0.5 text-[12.5px] text-ink-soft">
                Switch a field on to print it. Off leaves a blank line to fill in by hand.
              </p>
            </div>
            <span className="mono shrink-0 text-[12px] text-ink-soft">{printedCount} on</span>
          </header>

          <div className="divide-y divide-ink-line">
            <Field
              k="description"
              on={fields.on.description}
              setOn={setOn}
              label={TOGGLE_LABELS.description}
            >
              <textarea
                name="description"
                value={fields.description}
                onChange={(e) => setValueAndEnable("description", e.target.value)}
                rows={3}
                placeholder="Repair of site perimeter fencing at Plot 14…"
                className="input resize-y"
              />
            </Field>

            <Field k="amount" on={fields.on.amount} setOn={setOn} label={TOGGLE_LABELS.amount}>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-medium text-ink-soft">
                  PKR
                </span>
                <input
                  name="amount"
                  value={fields.amount}
                  onChange={(e) =>
                    // Digits, one decimal point, and commas the operator may paste in.
                    setValueAndEnable("amount", e.target.value.replace(/[^\d.,]/g, ""))
                  }
                  inputMode="decimal"
                  placeholder="45000"
                  className="input pl-[46px]"
                />
              </div>
              {words ? (
                <p className="mt-2 text-[12.5px] leading-snug text-ink-soft">
                  Prints as{" "}
                  <span className="font-medium text-ink">{words}</span>
                </p>
              ) : null}
            </Field>

            <Field
              k="recipientName"
              on={fields.on.recipientName}
              setOn={setOn}
              label={TOGGLE_LABELS.recipientName}
            >
              <input
                name="recipientName"
                value={fields.recipientName}
                onChange={(e) => setValueAndEnable("recipientName", e.target.value)}
                placeholder="Muhammad Aslam Khan"
                className="input"
              />
            </Field>

            <Field k="phone" on={fields.on.phone} setOn={setOn} label={TOGGLE_LABELS.phone}>
              <input
                name="phone"
                value={fields.phone}
                onChange={(e) => setValueAndEnable("phone", e.target.value)}
                inputMode="tel"
                placeholder="0300-1234567"
                className="input"
              />
            </Field>

            <Field
              k="voucherDate"
              on={fields.on.voucherDate}
              setOn={setOn}
              label={TOGGLE_LABELS.voucherDate}
            >
              <input
                type="date"
                value={fields.voucherDate}
                onChange={(e) => setValueAndEnable("voucherDate", e.target.value)}
                className="input"
              />
            </Field>

            <Field
              k="authorizedName"
              on={fields.on.authorizedName}
              setOn={setOn}
              label={TOGGLE_LABELS.authorizedName}
            >
              {signatories.length > 0 ? (
                <select
                  name="authorizedName"
                  value={fields.authorizedName}
                  onChange={(e) => setValueAndEnable("authorizedName", e.target.value)}
                  className="input"
                >
                  <option value="">Choose a signatory…</option>
                  {signatories.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="rounded-lg bg-[#f7f7f5] px-3.5 py-3 text-[13px] text-ink-soft">
                  No saved signatories yet. Add one in{" "}
                  <a href={`/${company}/settings`} className="font-medium text-ink underline">
                    Settings
                  </a>
                  , or leave this off and sign by hand.
                </div>
              )}
            </Field>

            <Field
              k="authorizedDate"
              on={fields.on.authorizedDate}
              setOn={setOn}
              label={TOGGLE_LABELS.authorizedDate}
            >
              <input
                type="date"
                value={fields.authorizedDate}
                onChange={(e) => setValueAndEnable("authorizedDate", e.target.value)}
                className="input"
              />
            </Field>
          </div>
        </section>

        <p className="text-[12.5px] leading-relaxed text-ink-soft">
          Payment Method and both signatures are always left blank — those are
          filled in and signed by hand on the printed copy.
        </p>
      </div>

      {/* ---- preview + submit ------------------------------------------ */}
      <aside className="lg:sticky lg:top-5">
        <div className="mb-2.5 flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold">Preview</h2>
          <span className="text-[12px] text-ink-soft">Exactly what prints</span>
        </div>

        <SheetPreview html={html} busy={busy} />

        <button type="submit" disabled={pending} className="btn btn-primary mt-4 w-full py-3">
          {pending ? "Generating…" : "Generate voucher & PDF"}
        </button>
        <p className="mt-2 text-center text-[12px] text-ink-soft">
          Assigns the next voucher number. <kbd className="font-sans font-medium">⌘</kbd>
          <kbd className="font-sans font-medium">↵</kbd>
        </p>
      </aside>
    </form>
  );
}

/** One row: toggle, label, hint, and the input it controls. */
function Field({
  k,
  on,
  setOn,
  label,
  children,
}: {
  k: ToggleKey;
  on: boolean;
  setOn: (k: ToggleKey, v: boolean) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`px-5 py-4 transition-colors ${on ? "" : "bg-[#fbfbfa]"}`}>
      <div className="flex items-start gap-3">
        <Toggle id={`toggle-${k}`} checked={on} onChange={(v) => setOn(k, v)} label={label} />
        <div className="min-w-0 flex-1">
          <label htmlFor={`toggle-${k}`} className="block text-[14px] font-medium leading-tight">
            {label}
          </label>
          <p className="mt-0.5 text-[12px] leading-snug text-ink-soft">
            {on ? HINTS[k] : "Blank line — filled in by hand. Type below to print it instead."}
          </p>
        </div>
      </div>

      {/* Left fully interactive while off — typing into a field is unambiguous
          intent to print it, and the input switches its own toggle on. Muted
          rather than dimmed, so it doesn't read as disabled. */}
      <div className={`mt-3 ${on ? "" : "opacity-70"}`}>{children}</div>
    </div>
  );
}
