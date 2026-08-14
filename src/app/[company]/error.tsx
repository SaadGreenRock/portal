"use client";

import { useParams } from "next/navigation";
import Trouble from "@/components/Trouble";

/**
 * A failure inside a company workspace.
 *
 * Nested here rather than left to the root boundary so the workspace shell —
 * the header, the company's colours, the module switcher — stays on screen. The
 * page failed; the portal did not, and the navigation still works.
 */
export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams<{ company: string }>();
  const slug = typeof params?.company === "string" ? params.company : "";

  return (
    <Trouble
      title="This screen could not be loaded"
      detail={error.digest ?? error.message}
      retry={reset}
      home={
        slug
          ? { href: `/${slug}`, label: "Back to the overview" }
          : { href: "/", label: "Go to the company picker" }
      }
    >
      <p>
        Something went wrong fetching this page. The other screens in this workspace are
        unaffected — the tabs above still work.
      </p>
      <p>
        <strong className="font-semibold text-ink">Nothing has been lost.</strong> No document was
        changed by this, and every number already issued is still issued.
      </p>
    </Trouble>
  );
}
