import { redirect } from "next/navigation";

/** Opening a workspace lands on Generate — the thing the operator came to do. */
export default async function CompanyHome({
  params,
}: {
  params: Promise<{ company: string }>;
}) {
  const { company } = await params;
  redirect(`/${company}/new`);
}
