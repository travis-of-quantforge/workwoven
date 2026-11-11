import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { authenticated } from "@/lib/supabase/server";

// Deduplicate layout/page reads within this request only. RLS still governs every query.
export const workspaceData = cache(async (id: string) => {
  let auth;
  try { auth = await authenticated(); } catch { redirect("/login"); }
  const { db, user } = auth;
  const [projectResult, membersResult, sidebarResult, profileResult, ownMembershipsResult] = await Promise.all([
    db.from("engagements").select("*").eq("id", id).single(),
    db.from("memberships").select("*").eq("engagement_id", id),
    db.from("engagements").select("id,title").order("created_at"),
    db.from("profiles").select("active_role").eq("id", user.id).maybeSingle(),
    db.from("memberships").select("engagement_id,role").eq("user_id", user.id),
  ]);
  const project = projectResult.data;
  if (!project) notFound();
  const members = membersResult.data || [];
  const role = members.find((m) => m.user_id === user.id)?.role;
  const activeRole: "client" | "professional" =
    profileResult.data?.active_role === "professional" ? "professional" : "client";
  const sidebarProjects = sidebarResult.data?.filter((p) =>
    p.id === id || ownMembershipsResult.data?.some((m) => m.engagement_id === p.id && m.role === activeRole),
  );
  const identities = await db.rpc("party_identities", { e: id });
  return { db, user, project, members, role, activeRole, sidebarProjects, identities };
});
