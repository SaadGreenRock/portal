import HomeButton from "@/components/HomeButton";
import LockButton from "@/components/LockButton";
import PortalClock from "@/components/PortalClock";
import ThemeToggle from "@/components/ThemeToggle";
import Weather from "@/components/Weather";

/**
 * The right-hand end of every header in the portal: the way home, what time it
 * is, the theme, and the way out.
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
      {/* First, where the "← Companies" button it replaces used to sit, and as
          far from Lock as this group has room for — see HomeButton for why those
          two are kept apart. It is also the one control here that is worth
          reaching for in a hurry, so it goes where nothing arriving later can
          move it. */}
      <HomeButton />

      {/* Left of the clock, and hidden below `sm`. The workspace header is
          already at its limit on a phone — 88px for a company name that needs
          88px — so there is nothing to give, and a phone knows the weather
          without being told. It arrives to the right of Home, so the one thing
          in this group with a fixed place keeps it when the weather lands. */}
      <Weather />
      <PortalClock iso={new Date().toISOString()} />
      <ThemeToggle />
      <LockButton />
    </div>
  );
}
