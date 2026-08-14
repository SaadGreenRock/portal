import LockButton from "@/components/LockButton";
import PortalClock from "@/components/PortalClock";
import ThemeToggle from "@/components/ThemeToggle";

/**
 * The right-hand end of every header in the portal: what time it is, the theme,
 * and the way out.
 *
 * One component rather than the same three tags written into five headers. Lock
 * and the theme control were already duplicated across all of them — the company
 * picker, each workspace, Food, Expenditure and Help — and each new one is
 * another place to forget. Grouping them means the trio arrives on any screen
 * that grows a header, in the same order, at the same size, with the same gap.
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
      <PortalClock iso={new Date().toISOString()} />
      <ThemeToggle />
      <LockButton />
    </div>
  );
}
