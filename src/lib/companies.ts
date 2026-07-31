/**
 * Company workspaces.
 *
 * Everything that differs between companies lives here: brand colours, the
 * voucher-number prefix, the logo, and the exact wording that appears on the
 * printed voucher. Adding a third company means adding one entry to this map
 * and dropping a logo into /public/logos — nothing else in the app is aware
 * of which companies exist.
 *
 * Colours and measurements were taken from the approved DOCX templates.
 */

export type CompanySlug = "green-rock" | "sportech";

export interface CompanyTheme {
  /** Header bar fill. `null` = no bar; logo sits on white (Sportech). */
  headerBar: string | null;
  /** Title text colour in the header. */
  headerText: string;
  /** Fill behind the Voucher No. / Date row. */
  metaFill: string | null;
  /** Fill behind the AMOUNT PAID / AMOUNT IN WORDS block. */
  amountFill: string;
  /** Label + rule colour inside the amount block. */
  amountInk: string;
  /** Footer bar fill. */
  footerBar: string | null;
  /** Footer text colour. */
  footerText: string;
  /** Accent used in the web UI (buttons, focus rings, active states). */
  ui: string;
  /** Readable text colour on top of `ui`. */
  uiText: string;
  /** Very light wash of `ui` for web UI surfaces. */
  uiWash: string;
}

export interface Company {
  slug: CompanySlug;
  /** Display name, e.g. "Green Rock". */
  name: string;
  /** Name as it appears in ALL CAPS on the voucher. */
  legalName: string;
  /** Voucher number prefix, e.g. "GR" → GR-202607-014. */
  prefix: string;
  logo: string;
  /** Rendered logo width on the voucher, in inches (from the DOCX). */
  logoWidthIn: number;
  /** Subtitle under the title. Sportech only; Green Rock has none. */
  subtitle: string | null;
  /** Footer strip text. */
  footer: string;
  /** Heading of the acknowledgment block. */
  ackHeading: string;
  /** English acknowledgment paragraph. */
  ackEnglish: string;
  /** Urdu acknowledgment paragraph (RTL, Nastaliq). */
  ackUrdu: string;
  /** Label above the company's own signature line. */
  authorizedLabel: string;
  /** Optional note printed under the signature block. */
  closingNote: string | null;
  theme: CompanyTheme;
  /** Signatory names seeded on first run; editable in Company Settings. */
  defaultSignatories: string[];
}

const ACK_EN = (name: string) =>
  `I, the undersigned, confirm that I have received the amount stated above in full, ` +
  `as payment for the task or item described above. I have no further claim against ` +
  `${name} in relation to this payment.`;

const ACK_UR = (nameUrdu: string) =>
  `میں تصدیق کرتا/کرتی ہوں کہ مجھے اوپر لکھے گئے کام یا چیز کی پوری رقم مل گئی ہے۔ ` +
  `اس ادائیگی کے بارے میں ${nameUrdu} سے میرا کوئی اور دعویٰ نہیں ہے۔`;

export const COMPANIES: Record<CompanySlug, Company> = {
  "green-rock": {
    slug: "green-rock",
    name: "Green Rock",
    legalName: "GREEN ROCK",
    prefix: "GR",
    logo: "/logos/green-rock.png",
    logoWidthIn: 1.83,
    subtitle: null,
    footer: "GREEN ROCK   |   For Company Records Only",
    ackHeading: "Acknowledgment   |   اقرار نامہ",
    ackEnglish: ACK_EN("GREEN ROCK"),
    ackUrdu: ACK_UR("گرین راک"),
    authorizedLabel: "Authorized Signature — Green Rock",
    closingNote: null,
    theme: {
      headerBar: "#104751",
      headerText: "#ffffff",
      metaFill: "#ecffd9",
      amountFill: "#dab99b",
      amountInk: "#104751",
      footerBar: "#104751",
      footerText: "#b6ddbd",
      ui: "#104751",
      uiText: "#ffffff",
      uiWash: "#f2f8f4",
    },
    defaultSignatories: [],
  },

  sportech: {
    slug: "sportech",
    name: "Sportech",
    legalName: "SPORTECH",
    prefix: "SPT",
    logo: "/logos/sportech.png",
    logoWidthIn: 2.39,
    subtitle: "SPORTECH   |   Payment & Task Record",
    footer: "SPORTECH   |   For Company Records Only",
    ackHeading: "Acknowledgment",
    ackEnglish: ACK_EN("SPORTECH"),
    ackUrdu: ACK_UR("سپورٹیک"),
    authorizedLabel: "Authorized Signature — Sportech",
    closingNote: "Keep this signed copy for company records.",
    theme: {
      headerBar: null,
      headerText: "#000000",
      metaFill: null,
      amountFill: "#f4f4f4",
      amountInk: "#000000",
      footerBar: null,
      footerText: "#6b6b6b",
      ui: "#1a1a1a",
      uiText: "#ecf800",
      uiWash: "#fafaf0",
    },
    defaultSignatories: [],
  },
};

export const COMPANY_LIST: Company[] = Object.values(COMPANIES);

export function getCompany(slug: string): Company | null {
  return COMPANIES[slug as CompanySlug] ?? null;
}

/** Throws if the slug is not a real workspace — use in routes. */
export function requireCompany(slug: string): Company {
  const c = getCompany(slug);
  if (!c) throw new Error(`Unknown company workspace: ${slug}`);
  return c;
}
