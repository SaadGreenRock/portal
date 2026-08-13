"use client";

import { useRouter } from "next/navigation";
import { useNotificationRender } from "@/lib/notifications/use-notification-render";

/**
 * Produces a notification's PNG and PDF from the browser.
 *
 * Shown when a notification has no stored files yet — either because the
 * render was interrupted, or because the browser that generated it could not
 * rasterise. The record already exists, so this is always safe to retry.
 */
export default function RenderNotificationButton({
  notificationId,
  label = "Render files",
}: {
  notificationId: string;
  label?: string;
}) {
  const render = useNotificationRender();
  const router = useRouter();

  async function run() {
    if (await render.tryBuild(notificationId)) router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button type="button" onClick={run} disabled={render.busy} className="btn btn-primary">
        {render.stage === "rendering"
          ? "Rendering…"
          : render.stage === "uploading"
            ? "Saving…"
            : label}
      </button>
      {render.error ? (
        <p role="alert" className="max-w-xs text-[12.5px] font-medium text-red-700">
          {render.error}
        </p>
      ) : null}
    </div>
  );
}
