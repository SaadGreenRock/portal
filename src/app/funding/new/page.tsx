import Link from "next/link";
import TrancheForm from "@/components/TrancheForm";
import { createTranche } from "@/lib/tranches/actions";
import { TRANCHE_DEFAULTS } from "@/lib/tranches/types";
import { todayIso } from "@/lib/format";

/**
 * Logging a tranche.
 *
 * Opens with today as the date received, because the overwhelmingly common case
 * is logging a wire the day it clears. The date sent is left blank rather than
 * guessed at — it is usually two or three days earlier and nobody knows which
 * until they look.
 */
export default function NewTranche() {
  return (
    <>
      <header className="mb-5">
        <h2 className="text-[17px] font-semibold">New tranche</h2>
        <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-ink-soft">
          One arrival of investor money. Enter what was sent and what actually landed, and the
          rate is worked out for you — expenses are then attributed to this tranche from the
          Allocate tab.
        </p>
      </header>

      <TrancheForm
        action={createTranche}
        tranche={{ ...TRANCHE_DEFAULTS, recvDate: todayIso() }}
        trancheNo={null}
        submitLabel="Log tranche"
        cancelHref="/funding"
      />

      <p className="mt-4 text-[12.5px] text-ink-soft">
        <Link href="/funding" className="underline underline-offset-2 hover:text-ink">
          Back to the tranches
        </Link>
      </p>
    </>
  );
}
