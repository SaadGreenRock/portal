import LockButton from "@/components/LockButton";
import PortalClock from "@/components/PortalClock";
import ThemeToggle from "@/components/ThemeToggle";
import Weather from "@/components/Weather";

/**
 * The right-hand end of every header in the portal: the weather, what time it
 * is, the theme, and the way out.
 *
 * One component rather than the same tags written into six headers. Lock and the
 * theme control were already duplicated across all of them — the company picker,
 * each workspace, Food, Funding, Expenditure and Help — and each new one is
 * another place to forget. Grouping them means the set arrives on any screen
 * that grows a header, in the same order, at the same size, with the same gap.
 *
 * `HomeButton` used to lead this group and no longer does: the way back belongs
 * at the start of a header, not the end of it, so each header now places it
 * itself at the far left. What is left here is a true group — four things you
 * consult or toggle, none of which navigates anywhere.
 *
 * The instant is taken here rather than passed in, so a caller cannot forget it
 * and no page has to know that the clock needs one. Two of these headers live in
 * a layout that is not re-rendered on a client navigation, so this value can be
 * hours old by the time it is read — which is exactly why the clock advances from
 * the browser's own clock rather than counting up from what it was handed.
 */
export default function HeaderControls() {
  return (
    <div className="flex shrink-0 items-center gap-2 sm:gap-3">
      {/* Hidden below `sm`. The workspace header is already at its limit on a
          phone — 88px for a company name that needs 88px — so there is nothing
          to give, and a phone knows the weather without being told. */}
      <Weather />
      <PortalClock iso={new Date().toISOString()} />
      <ThemeToggle />
      <LockButton />
    </div>
  );
}
