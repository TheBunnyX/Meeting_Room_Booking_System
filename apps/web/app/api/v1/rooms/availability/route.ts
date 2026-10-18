import { NextResponse } from "next/server";

import { parseQuery, route } from "@/lib/server/route";
import { currentUser } from "@/lib/server/security";
import { roomAvailability } from "@/lib/server/services/rooms";
import { availabilityQuerySchema } from "@/lib/server/validation";

export const GET = route(async (request) => {
  await currentUser(request);
  const query = parseQuery(request, availabilityQuerySchema);
  const requested = new Set(
    (query.facility_ids ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => /^\d+$/.test(item))
      .map(Number),
  );
  const result = await roomAvailability(query.starts_at, query.ends_at, query.capacity, query.building, requested);
  return NextResponse.json(result);
});
