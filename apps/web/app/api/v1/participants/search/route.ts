import { NextResponse } from "next/server";

import { parseQuery, route } from "@/lib/server/route";
import { currentUser } from "@/lib/server/security";
import { directoryRead } from "@/lib/server/serializers";
import { searchDirectory } from "@/lib/server/services/users";
import { searchQuerySchema } from "@/lib/server/validation";

export const GET = route(async (request) => {
  await currentUser(request);
  const { q } = parseQuery(request, searchQuerySchema);
  return NextResponse.json((await searchDirectory(q)).map(directoryRead));
});
