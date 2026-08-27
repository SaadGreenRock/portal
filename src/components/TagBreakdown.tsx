import { formatMoney } from "@/lib/money";
import type { TagCurrency, TagLine, TagSummary } from "@/lib/spend/tags";

/**
 * What the money went on, per currency, largest first.
 *
 * The bar under each row is the point of the panel. The question it answers —
 * what are we actually spending on — is a question about proportion, and a
 * column of figures makes the eye do arithmetic to answer it. Sorted largest
 * first, the shape of the spending reads before a single number is.
 *
 * One colour, not one per tag. A palette would have to invent a hue for every
 * category the operator ever adds, and by the eighth they are adjacent shades
 * nobody can tell apart — the same reasoning the drawdown bar gives for keeping
 * its five hues far apart, arriving at the opposite answer because that set is
 * fixed and this one is not. Rank and length carry it instead.
 *
 * Untagged is a row like any other, in grey, and it is what makes the panel
 * checkable: the rows add up to the Purchase orders figure printed above them.
 * Hidden, the breakdown would look complete while being a subset, which is the
 * one way a figure here could mislead.
 */
export default function TagBreakdown({
  summary,
  emphasis,
}: {
  summary: TagSummary;
  /** Larger type on the reconciling total, for the panel that leads a page. */
  emphasis?: boolean;
}) {
  if (summary.byCurrency.length === 0) {
    return (
      <p className="px-5 py-6 text-[13.5px] text-ink-soft">
        No purchase order line items in this period.
      </p>
    );
  }

  return (
    <>
      {summary.byCurrency.map((c) => (
        <CurrencyBlock
          key={c.currency}
          block={c}
          showCurrency={summary.byCurrency.length > 1}
          emphasis={emphasis}
        />
      ))}
    </>
  );
}

function CurrencyBlock({
  block,
  showCurrency,
  emphasis,
}: {
  block: TagCurrency;
  showCurrency: boolean;
  emphasis?: boolean;
}) {
  const share = (n: number) =>
    block.total > 0 ? Math.max(0, Math.min(100, (n / block.total) * 100)) : 0;

  return (
    <div className="border-b border-ink-line px-5 py-4 last:border-b-0">
      {showCurrency ? <p className="label mb-3">{block.currency}</p> : null}

      <dl className="space-y-3">
        {block.tags.map((line) => (
          <Row key={line.tagId} line={line} currency={block.currency} share={share(line.amount)} />
        ))}

        {/* Only when there is any. A fully tagged period should not carry a row
            reporting that nothing is left to do. */}
        {block.untagged.items > 0 ? (
          <Row
            line={block.untagged}
            currency={block.currency}
            share={share(block.untagged.amount)}
            muted
          />
        ) : null}

        <div className="flex items-baseline justify-between gap-4 border-t border-ink-line pt-3">
          <dt className={`font-semibold ${emphasis ? "text-[15px]" : "text-[13.5px]"}`}>
            Purchase orders
          </dt>
          <dd className={`mono font-bold ${emphasis ? "text-[18px]" : "text-[15px]"}`}>
            {block.currency} {formatMoney(block.total, block.currency)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function Row({
  line,
  currency,
  share,
  muted,
}: {
  line: TagLine;
  currency: string;
  share: number;
  muted?: boolean;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <dt
          className={`text-[13.5px] ${muted ? "text-ink-soft" : "font-medium"}`}
        >
          {line.name}
          <span className="ml-2 text-[12px] font-normal text-ink-soft">
            {line.items} {line.items === 1 ? "line" : "lines"}
          </span>
        </dt>
        <dd className={`mono text-[13.5px] ${muted ? "text-ink-soft" : "font-semibold"}`}>
          {currency} {formatMoney(line.amount, currency)}
        </dd>
      </div>

      {/* A proportion, not a control. The figure beside it is the precise
          answer; this is the one the eye gets for free. */}
      <div
        className="mt-1.5 h-1 overflow-hidden rounded-full bg-wash-strong"
        role="img"
        aria-label={`${Math.round(share)} per cent of purchase order spend`}
      >
        <span
          className={`block h-full rounded-full ${muted ? "bg-ink-soft/45" : "bg-[var(--accent)]"}`}
          style={{ width: `${share}%` }}
        />
      </div>
    </div>
  );
}
