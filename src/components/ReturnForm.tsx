import { CONDITIONS, CONDITION_LABELS, type ReturnFields } from "@/lib/assets/types";

/**
 * Records that an asset came back, closing the current holding.
 *
 * The condition is asked for here rather than being a property the operator edits
 * separately, because a return is the moment anybody actually looks at the thing.
 * It is written twice on purpose: onto the holding, where it says what state this
 * person gave it back in, and onto the asset, where it says what state the asset
 * is in now.
 */
export default function ReturnForm({
  action,
  initial,
  holderName,
}: {
  action: (form: FormData) => Promise<void>;
  initial: ReturnFields;
  /** Named in the heading so it is obvious whose holding is being closed. */
  holderName: string;
}) {
  return (
    <form action={action} className="card p-5 sm:p-6">
      <h2 className="text-[15px] font-semibold">Record its return</h2>
      <p className="mt-1 text-[13px] text-ink-soft">
        Closes {holderName}&rsquo;s holding and puts the asset back in stock.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label mb-1.5" htmlFor="returnedOn">
            Returned on
          </label>
          <input
            id="returnedOn"
            name="returnedOn"
            type="date"
            defaultValue={initial.returnedOn}
            required
            className="input"
          />
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="condition">
            Condition
          </label>
          <select
            id="condition"
            name="condition"
            defaultValue={initial.condition}
            className="input"
          >
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABELS[c]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label mb-1.5" htmlFor="note">
            Note
          </label>
          <input
            id="note"
            name="note"
            defaultValue={initial.note}
            maxLength={400}
            placeholder="Screen cracked, charger missing…"
            className="input"
          />
        </div>
      </div>

      <button type="submit" className="btn btn-primary mt-5">
        Record return
      </button>
    </form>
  );
}
