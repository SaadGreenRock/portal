import Link from "next/link";
import EmployeeSuggestions from "@/components/EmployeeSuggestions";
import type { AllotFields, AssetFields, EmployeeProfile } from "@/lib/assets/types";

/**
 * The asset form: what the thing is, and — when somebody has it — who.
 *
 * Shared by "New asset" and the edit view on a record. A plain
 * server-rendered form with no client JavaScript, unlike the purchase order and
 * quotation editors: those maintain a repeating line-item table and a live
 * preview, which needs state, while this is a few fields and a form that submits
 * without JavaScript cannot half-work.
 *
 * `holder` is null when the asset is in stock. The holder fields are then left
 * out entirely rather than disabled, because there is no open holding for them to
 * correct — giving it to somebody is the Allot form, not this one.
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
  submitLabel,
  cancelHref,
  assetNo,
}: {
  action: (form: FormData) => Promise<void>;
  asset: AssetFields;
  /** The open holding to correct, or null when the asset is in stock. */
  holder: AllotFields | null;
  employees: EmployeeProfile[];
  submitLabel: string;
  cancelHref: string;
  /** The number already assigned, shown read-only. `null` before it exists. */
  assetNo: string | null;
}) {
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
            <div>
              <label className="label mb-1.5" htmlFor="employeeName">
                Held by
              </label>
              <input
                id="employeeName"
                name="employeeName"
                defaultValue={holder.employeeName}
                list="employee-names"
                required
                maxLength={160}
                autoComplete="off"
                placeholder="Who has it"
                className="input"
              />
            </div>

            <div>
              <label className="label mb-1.5" htmlFor="employeeNo">
                Employee number
              </label>
              <input
                id="employeeNo"
                name="employeeNo"
                defaultValue={holder.employeeNo}
                list="employee-numbers"
                maxLength={40}
                autoComplete="off"
                placeholder="As already issued"
                className="input mono"
              />
              <p className="mt-1.5 text-[12.5px] text-ink-soft">
                The number your company already gave them. Not generated here.
              </p>
            </div>

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

            <EmployeeSuggestions employees={employees} />
          </>
        ) : null}
      </div>

      {holder ? (
        <p className="mt-4 text-[12.5px] leading-relaxed text-ink-soft">
          Editing here corrects the current holding. To record that it came back,
          use Return — that closes this period and keeps it in the history.
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
