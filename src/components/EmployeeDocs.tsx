import ReceiptField from "@/components/ReceiptField";
import { attachEmployeeDoc, removeEmployeeDoc } from "@/lib/employees/actions";
import { DOC_KINDS, DOC_LABELS, docOf, type DocKind, type Employee } from "@/lib/employees/types";
import { formatDate } from "@/lib/format";
import { fileUrl } from "@/lib/storage";

/**
 * An employee's CNIC and passport scans.
 *
 * Two slots rather than one "identity document", because one person may have
 * either, both or neither — a single slot would make you choose which to keep.
 *
 * Each replaces rather than accumulates, unlike an asset's photographs. There is
 * one current CNIC card; a pile of scans of it would be a pile to search, not a
 * history worth keeping. The file being replaced is deleted, because nothing else
 * can ever point at it.
 *
 * Both are served through /api/file, so a scan of somebody's national identity
 * card is behind the portal password and never on a public URL. Worth stating
 * plainly on the screen too: this is the most sensitive data the portal holds.
 */
export default function EmployeeDocs({
  employee,
  frozen,
}: {
  employee: Employee;
  /** Read-only once the record is in the bin. */
  frozen: boolean;
}) {
  return (
    <section className="card mb-5 overflow-hidden">
      <header className="border-b border-ink-line px-5 py-4">
        <h2 className="text-[15px] font-semibold">Documents</h2>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-soft">
          Behind the portal password and served through the portal itself — never on a public
          link. Both are optional.
        </p>
      </header>

      <div className="divide-y divide-ink-line">
        {DOC_KINDS.map((kind) => (
          <Slot key={kind} employee={employee} kind={kind} frozen={frozen} />
        ))}
      </div>
    </section>
  );
}

function Slot({
  employee,
  kind,
  frozen,
}: {
  employee: Employee;
  kind: DocKind;
  frozen: boolean;
}) {
  const doc = docOf(employee, kind);
  const number = kind === "cnic" ? employee.cnic : employee.passport;
  const attach = attachEmployeeDoc.bind(null, employee.id, kind);
  const drop = removeEmployeeDoc.bind(null, employee.id, kind);

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[13.5px] font-semibold">{DOC_LABELS[kind]}</p>
        {/* The typed number beside its scan: the pair is the record, and seeing
            them together is how a mismatch gets noticed at all. */}
        <p className="mono text-[13px] text-ink-soft">
          {number ?? <span className="not-italic">no number recorded</span>}
        </p>
      </div>

      {doc.key ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-3">
          <a
            href={fileUrl(doc.key, { v: doc.at })}
            target="_blank"
            rel="noreferrer"
            className="text-[13.5px] font-medium underline decoration-ink-line underline-offset-2 hover:decoration-current"
          >
            {doc.name || `${DOC_LABELS[kind]} scan`}
          </a>
          <span className="text-[12.5px] text-ink-soft">
            filed {doc.at ? formatDate(doc.at.slice(0, 10)) : "at some point"}
          </span>
          <a
            href={fileUrl(doc.key, { v: doc.at, download: true })}
            className="btn btn-quiet px-2.5 py-1.5 text-[12.5px]"
          >
            Download
          </a>
          {!frozen ? (
            <form action={drop}>
              <button
                type="submit"
                aria-label={`Remove the ${DOC_LABELS[kind]} scan`}
                className="btn btn-quiet px-2.5 py-1.5 text-[12.5px] hover:!bg-red-50 hover:!text-red-700"
              >
                Remove
              </button>
            </form>
          ) : null}
        </div>
      ) : (
        <p className="mt-1.5 text-[13px] text-ink-soft">Nothing filed.</p>
      )}

      {!frozen ? (
        <form action={attach} className="mt-3 flex flex-wrap items-end gap-3">
          <ReceiptField
            id={`doc-${kind}`}
            name="doc"
            label={doc.key ? `Replace the ${DOC_LABELS[kind]} scan` : `Upload the ${DOC_LABELS[kind]}`}
            optionalLabel={false}
            required
            hint="Photo or PDF — photos are shrunk before they are sent."
          />
          <button type="submit" className="btn btn-ghost">
            {doc.key ? "Replace" : "File it"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
