import { AppError } from "@/lib/server/errors";
import { clientAddress, parseBody, route } from "@/lib/server/route";
import { loginLimiter } from "@/lib/server/services/rateLimit";
import { authenticate } from "@/lib/server/services/users";
import { startSession } from "@/lib/server/session";
import { loginSchema } from "@/lib/server/validation";

export const POST = route(async (request) => {
  const { email, password } = await parseBody(request, loginSchema);
  const key = `${clientAddress(request)}|${email}`;
  const wait = await loginLimiter.retryAfter(key);
  if (wait) {
    throw new AppError(429, "TOO_MANY_ATTEMPTS", "Too many failed sign-in attempts. Try again later.", null, {
      "Retry-After": String(wait),
    });
  }
  const user = await authenticate(email, password);
  if (!user) {
    await loginLimiter.recordFailure(key);
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }
  await loginLimiter.reset(key);
  return startSession(user);
});
