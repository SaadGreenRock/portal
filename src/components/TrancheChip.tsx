import { formatMoney } from "@/lib/money";
import { STATE_LABELS, type TrancheStanding } from "@/lib/tranches/types";

/**
 * Where a bucket stands, as a chip.
 *
 * Only two states earn a colour. `Fully spent` is green because it is a job
 * finished, and `Overdrawn` is red because it is the one state that needs
 * attention whatever else is true of the bucket. The other three are grey on
 * purpose: a bucket being partly spent is the normal condition of a bucket, and
 * a badge that is always lit teaches you to stop reading it — the same reasoning
 * the asset register gives for having no badge at all.
 *
 * `Closed` carries its remainder in the chip rather than beside it, because the
 * remainder is the only reason the state exists. "Closed" on its own invites the
 * question this answers.
 */
export default function TrancheChip({ standing }: { standing: TrancheStanding }) {
  const { state, remaining, tranche } = standing;
  const money = `${tranche.recvCurrency} ${formatMoney(Math.abs(remaining), tranche.recvCurrency)}`;

  if (state === "overdrawn") {
    return (
      <span
        className="chip"
        style={{ background: "var(--danger)", color: "var(--danger-text)" }}
        title="More has been allocated out of this tranche than was received into it."
      >
        Overdrawn by {money}
      </span>
    );
  }

  if (state === "spent") return <span className="chip chip-completed">{STATE_LABELS.spent}</span>;

  if (state === "closed") {
    return (
      <span className="chip chip-neutral">
        {remaining > 0 ? `Closed · ${money} unspent` : STATE_LABELS.closed}
      </span>
    );
  }

  return <span className="chip chip-neutral">{STATE_LABELS[state]}</span>;
}
