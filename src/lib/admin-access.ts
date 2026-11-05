import "server-only";
import type { User } from "@supabase/supabase-js";

export function isWorkspaceAdmin(user: User) {
  const allowed = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return !!(
    user.email_confirmed_at &&
    user.email &&
    allowed.includes(user.email.toLowerCase())
  );
}
