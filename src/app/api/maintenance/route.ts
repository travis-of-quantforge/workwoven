import { timingSafeEqual } from "node:crypto";
import { adminDatabase } from "@/lib/supabase/admin";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const secret = process.env.MAINTENANCE_SECRET;
  if (!secret || secret.length < 32)
    return Response.json(
      { error: "Maintenance is not configured" },
      { status: 503 },
    );
  const supplied = request.headers.get("authorization") || "";
  const expected = "Bearer " + secret;
  if (
    Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  )
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  const { data, error } = await adminDatabase().rpc("recover_agent_runs");
  if (error)
    return Response.json(
      { error: "Recovery could not complete" },
      { status: 503 },
    );
  return Response.json(
    { releasedReservations: data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
