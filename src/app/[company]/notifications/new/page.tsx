import { notFound } from "next/navigation";
import NotificationForm from "@/components/NotificationForm";
import { getCompany } from "@/lib/companies";
import { todayIso } from "@/lib/format";
import { createNotification } from "@/lib/notifications/actions";

export default async function NewNotification({
  params,
}: {
  params: Promise<{ company: string }>;
}) {
  const { company: slug } = await params;
  const company = getCompany(slug);
  if (!company) notFound();

  // Bound to this workspace, so the form can never post into the other company.
  const action = createNotification.bind(null, company.slug);

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[20px] font-bold tracking-tight">Compose notification</h1>
        <p className="mt-1 text-[14px] text-ink-soft">
          A short announcement, rendered as a branded card ready for WhatsApp and email.
        </p>
      </div>

      <NotificationForm company={company.slug} today={todayIso()} action={action} />
    </>
  );
}
