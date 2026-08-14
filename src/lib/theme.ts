/**
 * The light/dark choice.
 *
 * Three states, not two. "Follow this device" has to be one of them and has to
 * be the default: most people set light or dark once, at the operating system,
 * and a portal that ignores that is a portal they have to correct every time
 * they are handed a different machine. The other two exist because the desk
 * this runs on is not always the machine the preference was set on — a shared
 * laptop at night, a bright office in the afternoon — and overriding it for one
 * site should not mean changing it for all of them.
 *
 * Kept in localStorage rather than a cookie, because the choice is a property
 * of the browser rather than of the session: it should survive locking the
 * portal, and it has no business travelling to the server on every request.
 */

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_KEY = "portal-theme";

/**
 * What the phone paints its own chrome with. The light value is the portal's
 * teal, which is what it has always been; the dark value is the page itself, so
 * the status bar stops being a bright band above a dark screen.
 */
export const THEME_COLOR = { light: "#104751", dark: "#131312" } as const;

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "system" || value === "light" || value === "dark";
}

/** Whether a choice lands on dark, asking the OS if it has to. */
export function resolvesDark(choice: ThemeChoice): boolean {
  if (choice !== "system") return choice === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Writes the choice onto <html>: the class Tailwind's `dark:` variants and the
 * token block key off, the attribute the toggle's own glyph keys off, and the
 * chrome colour.
 *
 * Storing is separate, and optional, because this also runs when the operating
 * system flips underneath a "system" choice — nothing was chosen, so nothing
 * should be written down.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  const dark = resolvesDark(choice);

  root.dataset.theme = choice;
  root.classList.toggle("dark", dark);

  // Every theme-color tag, not just the first.
  //
  // The layout writes exactly one by hand, so ordinarily this is a loop over
  // one element. It stays a loop because a browser takes the first tag whose
  // media matches, and one more appearing from anywhere — a metadata export
  // added later, a framework upgrade — would silently take precedence. Setting
  // all of them means the answer does not depend on which came first.
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  const colour = dark ? THEME_COLOR.dark : THEME_COLOR.light;
  if (metas.length === 0) {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", colour);
    document.head.appendChild(meta);
  } else {
    metas.forEach((meta) => meta.setAttribute("content", colour));
  }
}

export function readChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return isThemeChoice(stored) ? stored : "system";
  } catch {
    // Private browsing, or storage turned off. The portal still themes itself;
    // it just cannot remember being asked to.
    return "system";
  }
}

export function storeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // As above — losing the memo is survivable, throwing here is not.
  }
}

/**
 * The same work as `applyTheme` and `readChoice`, written out longhand to run
 * from a <script> tag in the document head.
 *
 * It is duplicated on purpose, and the duplication is the point: this has to
 * finish before the browser paints a single pixel, which means before any
 * bundle has loaded. Importing the functions above would put it after first
 * paint, and first paint is exactly where the wrong theme flashes.
 *
 * Wrapped in try/catch and doing nothing on failure: a portal in the light
 * theme is a working portal, and a script in the head that throws is a blank
 * page.
 */
export const THEME_SCRIPT = `(function(){try{
var s=localStorage.getItem(${JSON.stringify(THEME_KEY)});
var c=s==="light"||s==="dark"||s==="system"?s:"system";
var d=c==="dark"||(c==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);
var k=d?${JSON.stringify(THEME_COLOR.dark)}:${JSON.stringify(THEME_COLOR.light)};
var r=document.documentElement;
r.setAttribute("data-theme",c);
r.classList.toggle("dark",d);
var m=document.querySelectorAll('meta[name="theme-color"]');
if(!m.length){var n=document.createElement("meta");n.setAttribute("name","theme-color");n.setAttribute("content",k);document.head.appendChild(n);}
else{for(var i=0;i<m.length;i++)m[i].setAttribute("content",k);}
}catch(e){}})();`;
