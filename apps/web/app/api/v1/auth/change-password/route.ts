import { parseBody, route } from "@/lib/server/route";
import { authenticatedUser } from "@/lib/server/security";
import { changePassword } from "@/lib/server/services/users";
import { startSession } from "@/lib/server/session";
import { changePasswordSchema } from "@/lib/server/validation";

export const POST = route(async (request) => {
  const user = await authenticatedUser(request);
  const { current_password, new_password } = await parseBody(request, changePasswordSchema);
  const updated = await changePassword(user, current_password, new_password);
  // Changing the password revokes every existing session, so issue a fresh one for this browser.
  return startSession(updated);
});
