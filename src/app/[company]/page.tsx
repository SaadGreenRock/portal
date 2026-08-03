import { redirect } from "next/navigation";

/**
 * Opening a workspace lands on Generate — the thing the operator came to do.
 * Every other module is one click away in the nav, so nothing stands between
 * the operator and the work.
 */
export default async function CompanyHome({
  params,
}: {
  params: Promise<{ company: string }>;
}) {
  const { company } = await params;
  redirect(`/${company}/vouchers/new`);
}
