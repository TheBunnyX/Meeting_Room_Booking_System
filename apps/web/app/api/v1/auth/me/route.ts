import { NextResponse } from "next/server";

import { route } from "@/lib/server/route";
import { authenticatedUser } from "@/lib/server/security";
import { userRead } from "@/lib/server/serializers";

export const GET = route(async (request) => NextResponse.json(userRead(await authenticatedUser(request))));
