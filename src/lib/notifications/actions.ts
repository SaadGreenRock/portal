"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAuthenticated } from "../auth";
import { requireCompany, type CompanySlug } from "../companies";
import { store } from "../db";
import { readNotificationFields } from "./parse";

async function requireAuth() {
  if (!(await isAuthenticated())) redirect("/login");
}

/** Every path a notification appears on. */
function revalidateNotifications(company: string, id?: string) {
  revalidatePath(`/${company}/notifications/history`);
  if (id) revalidatePath(`/${company}/notifications/${id}`);
}

export interface SavedNotification {
  id: string;
  notifNo: string;
  company: string;
}

function readForm(form: FormData) {
  return readNotificationFields({
    headline: form.get("headline"),
    body: form.get("body"),
    tag: form.get("tag"),
    sender: form.get("sender"),
    notifyDate: form.get("notifyDate"),
  });
}

/**
 * Creates the notification record, which assigns its permanent number.
 *
 * The PNG and PDF are not produced here — same reasoning as every other
 * module's create action: they are rendered in the operator's browser and
 * posted back to /api/notification/[id]/image and /api/notification/[id]/pdf.
 */
export async function createNotification(
  companySlug: string,
  form: FormData,
): Promise<SavedNotification> {
  await requireAuth();
  const company = requireCompany(companySlug);
  const fields = readForm(form);

  const db = await store();
  const n = await db.createNotification({ company: company.slug as CompanySlug, fields });

  revalidateNotifications(company.slug);
  return { id: n.id, notifNo: n.notifNo, company: company.slug };
}

/**
 * Deletes a notification. The row is kept, so its number stays spent and the
 * delete can be undone in full — the same reasoning as every other module.
 */
export async function deleteNotification(id: string) {
  await requireAuth();
  const db = await store();
  const n = await db.getNotification(id);
  if (!n) throw new Error("Notification not found");

  await db.softDeleteNotification(id);
  revalidateNotifications(n.company, n.id);
  redirect(`/${n.company}/notifications/history?deleted=${encodeURIComponent(n.notifNo)}`);
}

export async function restoreNotification(id: string) {
  await requireAuth();
  const db = await store();
  const n = await db.getNotification(id);
  if (!n) throw new Error("Notification not found");

  await db.restoreNotification(id);
  revalidateNotifications(n.company, n.id);
  redirect(`/${n.company}/notifications/${n.id}`);
}
