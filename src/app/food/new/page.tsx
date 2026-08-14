import FoodForm from "@/components/FoodForm";
import ModuleUnavailable from "@/components/ModuleUnavailable";
import { store } from "@/lib/db";
import { tryTable } from "@/lib/db/resilience";
import { createFood } from "@/lib/food/actions";
import { emptyFood } from "@/lib/food/types";
import { todayIso } from "@/lib/format";

/**
 * Logging an order.
 *
 * Dated today and deferred by default, which is much the commonest case: the
 * café runs a tab and the bill is settled at the end of the week.
 */
export default async function NewFoodEntry() {
  const db = await store();
  const names = await tryTable(() => db.foodNames());
  if (!names.ok) return <ModuleUnavailable module="Food" />;

  return (
    <>
      <div className="mb-6">
        <h2 className="text-[20px] font-bold tracking-tight">New entry</h2>
        <p className="mt-1 text-[14px] text-ink-soft">
          Saving assigns the next F- number for this month.
        </p>
      </div>

      <FoodForm
        action={createFood}
        entry={emptyFood(todayIso())}
        vendors={names.value.vendors}
        payers={names.value.payers}
        orderedFor={names.value.orderedFor}
        submitLabel="Save entry"
        cancelHref="/food"
        entryNo={null}
      />
    </>
  );
}
