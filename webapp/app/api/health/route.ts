import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Liveness probe for container health checks; deliberately touches nothing else.
export function GET() {
  return NextResponse.json({ status: "ok" });
}
