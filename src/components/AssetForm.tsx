import Link from "next/link";
import EmployeePicker from "@/components/EmployeePicker";
import type { AllotFields, AssetFields } from "@/lib/assets/types";
import type { EmployeeSummary } from "@/lib/employees/types";

/**
 * The asset form: what the thing is, and — when somebody has it — who.
 *
 * Shared by "New asset" and the edit view on a record. A plain
 * server-rendered form with no client JavaScript, unlike the purchase order and
 * quotation editors: those maintain a repeating line-item table and a live
 * preview, which needs state, while this is a few fields and a form that submits
 * without JavaScript cannot half-work.
 *
 * `holder` is null when an existing asset is in stock. The holder fields are then
 * left out entirely rather than disabled, because there is no open holding for
 * them to correct — giving it to somebody is the Allot form, not this one.
 *
 * `allowNobody` is what makes a new asset able to start in stock. It could not
 * before: an allotment was part of creating an asset, so a laptop bought last
 * week that nobody has yet could not be recorded at all.
 *
 * `required` and `maxLength` mirror what the action enforces. The action is still
 * the authority; the attributes exist so the operator is told before the round
 * trip, not so the server can trust the post.
 */
export default function AssetForm({
  action,
  asset,
  holder,
  employees,
  company,
  submitLabel,
  cancelHref,
  assetNo,
  allowNobody = false,
}: {
  action: (form: FormData) => Promise<void>;
  asset: AssetFields;
  /** The open holding to correct, or null when an existing asset is in stock. */
  holder: AllotFields | null;
  employees: EmployeeSummary[];
  company: string;
  submitLabel: string;
  cancelHref: string;
  /** The number already assigned, shown read-only. `null` before it exists. */
  assetNo: string | null;
  /** New assets may be logged with nobody holding them. */
  allowNobody?: boolean;
}) {
  // A holding recorded before the employee register existed: it has a name but
  // no link. Offered back as "keep as typed" so correcting the date cannot
  // silently blank a name nobody can recover.
  const keep =
    holder && !holder.employeeId && holder.employeeName
      ? { name: holder.employeeName, no: holder.employeeNo }
      : null;

  return (
    <form action={action} className="card p-5 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <p className="label mb-1.5">Asset number</p>
          <p className="mono text-[15px] font-semibold">
            {assetNo ?? (
              <span className="text-[14px] font-normal text-ink-soft">
                Assigned when you save, and permanent afterwards.
              </span>
            )}
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className="label mb-1.5" htmlFor="assetName">
            Asset
          </label>
          <input
            id="assetName"
            name="assetName"
            defaultValue={asset.assetName}
            required
            maxLength={300}
            placeholder="Dell Latitude 5540 laptop"
            className="input"
          />
        </div>

        {holder ? (
          <>
            <EmployeePicker
              employees={employees}
              company={company}
              value={holder.employeeId}
              keep={keep}
              required={!allowNobody}
              label={allowNobody ? "Give it to" : "Held by"}
            />

            <div>
              <label className="label mb-1.5" htmlFor="allottedOn">
                Held since
              </label>
              <input
                id="allottedOn"
                name="allottedOn"
                type="date"
                defaultValue={holder.allottedOn}
                className="input"
              />
            </div>
          </>
        ) : null}
      </div>

      {holder && !allowNobody ? (
        <p className="mt-4 text-[12.5px] leading-relaxed text-ink-soft">
          Editing here corrects the current holding. To record that it came back,
          use Return — that closes this period and keeps it in the history.
        </p>
      ) : null}
      {allowNobody ? (
        <p className="mt-4 text-[12.5px] leading-relaxed text-ink-soft">
          Leave the holder as <em>In stock</em> if nobody has it yet. You can hand it over any
          time from the asset&rsquo;s own screen, and that is what starts its history.
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-primary">
          {submitLabel}
        </button>
        <Link href={cancelHref} className="btn btn-ghost">
          Cancel
        </Link>
      </div>
    </form>
  );
}
