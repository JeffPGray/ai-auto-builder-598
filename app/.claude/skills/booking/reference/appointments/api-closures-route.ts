import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/booking/supabase";
import { isAdminAuthenticated } from "@/lib/booking/admin-session";

/**
 * Closure management for the dashboard (appointments variant). Installed by
 * the Klaudius booking skill as
 * `src/app/api/booking/admin/closures/route.ts`. Generic plumbing — do not
 * edit per site.
 *
 *   GET    ?from=YYYY-MM-DD&to=YYYY-MM-DD — list closures in range
 *   POST   { date, staffId | null, reason? } — close the business (null) or
 *          mark one staff member unavailable for the day
 *   DELETE { id }                           — re-open
 *
 * All admin-only. Closures take effect immediately: the availability RPC and
 * the create RPC both read this table live.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const params = request.nextUrl.searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) {
    return NextResponse.json({ error: "from and to must be YYYY-MM-DD" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin()
    .from("biz_closures")
    .select("id, closure_date, staff_id, reason")
    .gte("closure_date", from)
    .lte("closure_date", to)
    .order("closure_date", { ascending: true });

  if (error) {
    console.error("Closures query error:", error);
    return NextResponse.json({ error: "Failed to fetch closures" }, { status: 500 });
  }
  return NextResponse.json({ closures: data });
}

export async function POST(request: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { date?: unknown; staffId?: unknown; reason?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const date = typeof body.date === "string" ? body.date : "";
  const staffId = typeof body.staffId === "string" ? body.staffId : null;
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";

  if (!ISO_DATE.test(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }
  if (staffId !== null && !UUID.test(staffId)) {
    return NextResponse.json({ error: "Invalid staff" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin()
    .from("biz_closures")
    .insert({ closure_date: date, staff_id: staffId, reason })
    .select("id")
    .maybeSingle();

  if (error) {
    // 23505 = already closed — treat as success (idempotent close).
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ success: true, alreadyClosed: true });
    }
    // 23503 = staff id doesn't exist (deleted in another tab) — client error.
    if ((error as { code?: string }).code === "23503") {
      return NextResponse.json({ error: "Unknown staff member" }, { status: 400 });
    }
    console.error("Closure insert error:", error);
    return NextResponse.json({ error: "Failed to add closure" }, { status: 500 });
  }
  return NextResponse.json({ success: true, id: data?.id });
}

export async function DELETE(request: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const { error } = await supabaseAdmin().from("biz_closures").delete().eq("id", id);
  if (error) {
    console.error("Closure delete error:", error);
    return NextResponse.json({ error: "Failed to remove closure" }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
