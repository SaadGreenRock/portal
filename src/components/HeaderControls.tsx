import LockButton from "@/components/LockButton";
import SearchPalette from "@/components/SearchPalette";
import PortalClock from "@/components/PortalClock";
import ThemeToggle from "@/components/ThemeToggle";
import Weather from "@/components/Weather";

/**
 * The right-hand end of every header in the portal: search, the weather, what
 * time it is, the theme, and the way out.
 *
 * One component rather than the same tags written into six headers. Lock and the
 * theme control were already duplicated across all of them — the company picker,
 * each workspace, Food, Funding, Expenditure and Help — and each new one is
 * another place to forget. Grouping them means the set arrives on any screen
 * that grows a header, in the same order, at the same size, with the same gap.
 *
 * `HomeButton` used to lead this group and no longer does: the way back belongs
 * at the start of a header, not the end of it, so each header now places it
 * itself at the far left.
 *
 * Search sits here rather than joining it, and the line between them is real
 * even though both end in going somewhere. Home is a fixed destination, which is
 * why it reads as a back-and-up control and belongs where every back-and-up
 * control on a screen belongs. Search is a tool you pick up: it has no
 * destination until you have typed one, and it lives with the other things that
 * are on every screen because they are always to hand rather than because they
 * are part of this page.
 *
 * First in the group, because it is the only one here anybody opens on purpose —
 * and as far from Lock as this group has room for, which is the same reasoning
 * that keeps Home away from it.
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
      <SearchPalette />

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
