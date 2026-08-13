"use server";

import { redirect } from "next/navigation";
import { endSession } from "./auth";

/**
 * Ends the session and always returns to the landing page.
 *
 * Shared by every "Lock" button in the portal — root, the workspace shell,
 * Food and Expenditure — so locking behaves identically no matter which
 * screen it was pressed from, the same way unlocking always lands on "/".
 */
export async function signOut() {
  await endSession();
  redirect("/");
}
