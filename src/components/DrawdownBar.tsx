import { formatMoney } from "@/lib/money";
import { SOURCE_KINDS, SOURCE_LABELS_PLURAL, type TrancheStanding } from "@/lib/tranches/types";

/**
 * How much of a tranche has gone, and on what.
 *
 * A single bar rather than four figures, because the question it answers is
 * "how much is left" and a proportion answers that faster than arithmetic on
 * four numbers does. The segments are the four kinds of expense in their own
 * colours, so the shape of a bucket's spending — mostly vouchers, or mostly one
 * big order — reads without a legend being studied.
 *
 * The remainder is hatched rather than filled. A fifth solid colour would read
 * as a fifth kind of spending, which is exactly what it is not.
 *
 * Each kind states both a day and a night colour. Inverting a hue by formula
 * gets the arithmetic right and the colour wrong, which is the reasoning the
 * company themes already set out — so each is named, and two of the four borrow
 * a colour the portal already uses for that idea: the teal vouchers share with
 * the accent, and the warm brown food already wears on the expenditure report.
 */
export const KIND_SWATCH: Record<
  (typeof SOURCE_KINDS)[number],
  { day: string; night: string }
> = {
  voucher: { day: "#104751", night: "#4fb3a1" },
  po: { day: "#3f5d7a", night: "#89b2d6" },
  food: { day: "#b8894a", night: "#d9a76a" },
  direct: { day: "#6b4a6e", night: "#bd93c1" },
};

/** The square a legend line or a bar segment is painted in. */
function swatchStyle(kind: (typeof SOURCE_KINDS)[number]): React.CSSProperties {
  return {
    "--swatch": KIND_SWATCH[kind].day,
    "--swatch-dark": KIND_SWATCH[kind].night,
  } as React.CSSProperties;
}

export default function DrawdownBar({
  standing,
  legend = true,
}: {
  standing: TrancheStanding;
  /** Off on a dense list, where the bar is a proportion and not a breakdown. */
  legend?: boolean;
}) {
  const { tranche, byKind, remaining, allocated } = standing;
  const received = tranche.recvAmount;

  // Widths as a share of what was received. An overdrawn bucket is drawn full
  // rather than overflowing its own container: the red figure beside it is what
  // says by how much, and a bar spilling past its track would only say "more
  // than all of it" less precisely.
  const pct = (n: number) => (received > 0 ? Math.max(0, Math.min(100, (n / received) * 100)) : 0);
  const spent = SOURCE_KINDS.filter((k) => byKind[k] > 0);

  return (
    <div>
      <div
        className="flex h-3 overflow-hidden rounded-full bg-wash-strong"
        role="img"
        aria-label={
          received > 0
            ? `${Math.round((allocated / received) * 100)} per cent allocated`
            : "nothing received"
        }
      >
        {spent.map((kind) => (
          <span
            key={kind}
            className="swatch block"
            style={{ ...swatchStyle(kind), width: `${pct(byKind[kind])}%` }}
          />
        ))}
      </div>

      {legend && spent.length > 0 ? (
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
          {spent.map((kind) => (
            <div key={kind} className="flex items-center gap-2 text-[12.5px]">
              <span
                aria-hidden
                className="swatch block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={swatchStyle(kind)}
              />
              <dt className="text-ink-soft">{SOURCE_LABELS_PLURAL[kind]}</dt>
              <dd className="mono font-medium">
                {tranche.recvCurrency} {formatMoney(byKind[kind], tranche.recvCurrency)}
              </dd>
            </div>
          ))}
          <div className="flex items-center gap-2 text-[12.5px]">
            <span
              aria-hidden
              className="block h-2.5 w-2.5 shrink-0 rounded-sm bg-wash-strong"
            />
            <dt className="text-ink-soft">{remaining < 0 ? "Overdrawn" : "Remaining"}</dt>
            <dd className={`mono font-medium ${remaining < 0 ? "text-[var(--danger)]" : ""}`}>
              {tranche.recvCurrency} {formatMoney(Math.abs(remaining), tranche.recvCurrency)}
            </dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}
