import { parseQuery, route } from "@/lib/server/route";
import { requireRoles } from "@/lib/server/security";
import { bookingsCsv } from "@/lib/server/services/operations";
import { periodOptionalQuerySchema } from "@/lib/server/validation";

export const GET = route(async (request) => {
  await requireRoles(request, "ADMIN", "FACILITY_ADMIN");
  const { starts_at, ends_at } = parseQuery(request, periodOptionalQuerySchema);
  return new Response(await bookingsCsv(starts_at, ends_at), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="bookings.csv"',
    },
  });
});
