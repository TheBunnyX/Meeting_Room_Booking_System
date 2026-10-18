import { NextResponse } from "next/server";

import { AppError } from "@/lib/server/errors";
import { clientAddress, parseBody, route } from "@/lib/server/route";
import { forgotPasswordLimiter } from "@/lib/server/services/rateLimit";
import { requestPasswordReset } from "@/lib/server/services/users";
import { forgotPasswordSchema } from "@/lib/server/validation";

export const POST = route(async (request) => {
  const { email } = await parseBody(request, forgotPasswordSchema);
  const client = clientAddress(request);
  const wait = await forgotPasswordLimiter.retryAfter(client);
  if (wait) {
    throw new AppError(429, "TOO_MANY_ATTEMPTS", "Too many reset requests. Try again later.", null, {
      "Retry-After": String(wait),
    });
  }
  await forgotPasswordLimiter.recordFailure(client);
  await requestPasswordReset(email);
  // The same answer whether or not the account exists, so emails cannot be enumerated.
  return NextResponse.json({
    message: "If that account exists, an administrator has been asked to issue a temporary password.",
  });
});
