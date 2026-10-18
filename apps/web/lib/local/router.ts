import { ZodError, type ZodType } from "zod";
import { Database } from "./database";
import { LocalApiError } from "./errors";
import * as accounts from "./handlers/accounts";
import * as bookings from "./handlers/bookings";
import * as operations from "./handlers/operations";
import * as rooms from "./handlers/rooms";
import { type Ctx, type SessionRec, current } from "./handlers/shared";
import { encodeImageFile } from "./image";
import { PBKDF2_ITERATIONS } from "./password";
import { type KeyValueStorage, browserStorage } from "./storage";
import * as v from "./validation";

const SESSION_KEY = "meetinghub_session";
const API_PREFIX = "/api/v1";

export type ApiOptions = {
  storage?: KeyValueStorage;
  /** The clock; tests move it to exercise check-in windows and no-shows. */
  now?: () => Date;
  encodeImage?: (file: File) => Promise<string>;
  hashIterations?: number;
};

type Input = { params: Record<string, string>; query: Record<string, string>; json: unknown; form: FormData | null };
type Run = (ctx: Ctx, input: Input) => unknown | Promise<unknown>;
type Route = { method: string; pattern: RegExp; names: string[]; run: Run };

/** A response body that is not JSON, such as the CSV export. */
class TextBody {
  constructor(
    readonly text: string,
    readonly contentType: string,
    readonly headers: Record<string, string> = {},
  ) {}
}

function route(method: string, path: string, run: Run): Route {
  const names: string[] = [];
  const source = path.replace(/:(\w+)/g, (_, name: string) => {
    names.push(name);
    return "([^/]+)";
  });
  return { method, pattern: new RegExp(`^${source}$`), names, run };
}

const parse = <T>(schema: ZodType<T>, value: unknown) => schema.parse(value);

function body<T>(input: Input, schema: ZodType<T>) {
  if (input.json === undefined) throw new LocalApiError(422, "VALIDATION_ERROR", "The request body must be valid JSON");
  return schema.parse(input.json);
}

function id(input: Input, name: string) {
  const value = input.params[name];
  if (!/^\d{1,9}$/.test(value)) throw new LocalApiError(422, "VALIDATION_ERROR", `${name} must be a number`, name);
  return Number(value);
}

const roomId = (input: Input) => id(input, "roomId");
const bookingId = (input: Input) => id(input, "bookingId");

// Static paths come before paths with a parameter in the same position.
const ROUTES: Route[] = [
  route("POST", "/auth/login", (ctx, input) => accounts.login(ctx, body(input, v.loginSchema))),
  route("POST", "/auth/forgot-password", (ctx, input) => accounts.forgotPassword(ctx, body(input, v.forgotPasswordSchema))),
  route("POST", "/auth/logout", (ctx) => accounts.logout(ctx)),
  route("GET", "/auth/me", (ctx) => accounts.me(ctx)),
  route("POST", "/auth/change-password", (ctx, input) => accounts.changePassword(ctx, body(input, v.changePasswordSchema))),

  route("GET", "/participants/search", (ctx, input) => {
    current(ctx);
    return accounts.searchDirectory(ctx, parse(v.searchQuerySchema, input.query).q);
  }),
  route("GET", "/users", (ctx, input) => {
    const { limit, offset } = parse(v.pageQuerySchema, input.query);
    return accounts.listUsers(ctx, limit, offset);
  }),
  route("POST", "/users", (ctx, input) => accounts.createUser(ctx, body(input, v.userCreateSchema))),
  route("PATCH", "/users/:userId", (ctx, input) => accounts.updateUser(ctx, id(input, "userId"), body(input, v.userUpdateSchema))),
  route("POST", "/users/:userId/reset-password", (ctx, input) => accounts.resetPassword(ctx, id(input, "userId"))),

  route("GET", "/facilities", (ctx) => rooms.listFacilities(ctx)),
  route("GET", "/rooms", (ctx, input) => rooms.listRooms(ctx, parse(v.roomsQuerySchema, input.query))),
  route("POST", "/rooms", (ctx, input) => rooms.createRoom(ctx, body(input, v.roomInputSchema))),
  route("GET", "/rooms/availability", (ctx, input) => rooms.roomAvailability(ctx, parse(v.availabilityQuerySchema, input.query))),
  route("GET", "/rooms/occupancy", (ctx, input) => rooms.roomOccupancy(ctx, parse(v.periodRequiredQuerySchema, input.query))),
  route("PATCH", "/rooms/:roomId", (ctx, input) => rooms.updateRoom(ctx, roomId(input), body(input, v.roomUpdateSchema))),
  // Rooms are never deleted: removing one deactivates it so its booking history stays intact.
  route("DELETE", "/rooms/:roomId", (ctx, input) => rooms.setRoomActive(ctx, roomId(input), false)),
  route("POST", "/rooms/:roomId/activate", (ctx, input) => rooms.setRoomActive(ctx, roomId(input), true)),
  route("GET", "/rooms/:roomId/check-in-token", (ctx, input) => rooms.checkInToken(ctx, roomId(input))),
  route("POST", "/rooms/:roomId/check-in", (ctx, input) => {
    current(ctx);
    const room = roomId(input);
    rooms.verifyCheckInCode(ctx, body(input, v.checkInCodeSchema).token, room);
    return bookings.checkInAtRoom(ctx, room);
  }),
  route("POST", "/rooms/:roomId/image", (ctx, input) => rooms.uploadRoomImage(ctx, roomId(input), input.form)),
  route("DELETE", "/rooms/:roomId/image", (ctx, input) => rooms.deleteRoomImage(ctx, roomId(input))),

  route("POST", "/bookings", (ctx, input) => bookings.createBooking(ctx, body(input, v.bookingInputSchema))),
  route("GET", "/bookings/schedule", (ctx, input) => bookings.listSchedule(ctx, parse(v.periodRequiredQuerySchema, input.query))),
  route("GET", "/bookings/my", (ctx, input) => {
    const { limit, offset } = parse(v.pageQuerySchema, input.query);
    return bookings.listMyBookings(ctx, limit, offset);
  }),
  route("GET", "/bookings/invited", (ctx) => bookings.listInvited(ctx)),
  route("GET", "/bookings/pending", (ctx) => bookings.listPending(ctx)),
  route("PATCH", "/bookings/:bookingId", (ctx, input) => bookings.updateBooking(ctx, bookingId(input), body(input, v.bookingUpdateSchema))),
  route("POST", "/bookings/:bookingId/cancel", (ctx, input) => bookings.cancelBooking(ctx, bookingId(input))),
  route("POST", "/bookings/:bookingId/cancel-series", (ctx, input) => bookings.cancelSeries(ctx, bookingId(input))),
  route("POST", "/bookings/:bookingId/approve", (ctx, input) => bookings.decideBooking(ctx, bookingId(input), true)),
  route("POST", "/bookings/:bookingId/reject", (ctx, input) =>
    bookings.decideBooking(ctx, bookingId(input), false, body(input, v.rejectSchema).reason),
  ),
  route("POST", "/bookings/:bookingId/check-in", (ctx, input) => bookings.checkIn(ctx, bookingId(input))),
  route("POST", "/jobs/expire-no-shows", (ctx) => bookings.runSweep(ctx)),
  route("GET", "/booking-policy", (ctx) => {
    current(ctx);
    return bookings.policy();
  }),

  route("GET", "/notifications", (ctx, input) => operations.listNotifications(ctx, parse(v.notificationsQuerySchema, input.query).limit)),
  route("POST", "/notifications/read-all", (ctx) => operations.markAllNotificationsRead(ctx)),
  route("POST", "/notifications/:notificationId/read", (ctx, input) => operations.markNotificationRead(ctx, id(input, "notificationId"))),

  route("GET", "/maintenance", (ctx) => operations.listMaintenance(ctx)),
  route("POST", "/maintenance", (ctx, input) => operations.createMaintenance(ctx, body(input, v.maintenanceInputSchema))),
  route("DELETE", "/maintenance/:maintenanceId", (ctx, input) => operations.removeMaintenance(ctx, id(input, "maintenanceId"))),
  route("GET", "/dashboard", (ctx) => operations.dashboard(ctx)),
  route("GET", "/reports/summary", (ctx, input) => operations.reportSummary(ctx, parse(v.periodOptionalQuerySchema, input.query))),
  route("GET", "/reports/bookings.csv", (ctx, input) =>
    new TextBody(operations.bookingsCsv(ctx, parse(v.periodOptionalQuerySchema, input.query)), "text/csv; charset=utf-8", {
      "Content-Disposition": 'attachment; filename="bookings.csv"',
    }),
  ),
  route("GET", "/audit-logs", (ctx, input) => operations.listAuditLogs(ctx, parse(v.auditQuerySchema, input.query))),
];

function readSession(storage: KeyValueStorage): SessionRec | null {
  const raw = storage.get(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionRec;
  } catch {
    return null;
  }
}

function json(status: number, payload: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function errorResponse(error: unknown) {
  if (error instanceof LocalApiError) {
    return json(error.status, { error: { code: error.code, message: error.message, field: error.field } }, error.headers);
  }
  if (error instanceof ZodError) {
    const first = error.issues[0];
    return json(422, { error: { code: "VALIDATION_ERROR", message: first.message, field: first.path.map(String).join(".") || null } });
  }
  console.error("Unhandled error", error);
  return json(500, { error: { code: "INTERNAL_ERROR", message: "Something went wrong", field: null } });
}

/**
 * The whole "backend", running inside the browser. It answers the same /api/v1 requests as a server would, with
 * the data kept in localStorage. Requests are handled one at a time so two of them can never overwrite each other.
 */
export function createApi(options: ApiOptions = {}) {
  const storage = options.storage ?? browserStorage();
  let queue: Promise<unknown> = Promise.resolve();

  async function execute(method: string, rawPath: string, init: { json?: unknown; body?: BodyInit | null }) {
    const url = new URL(rawPath, "http://local");
    const path = url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length) : url.pathname;
    const candidates = ROUTES.map((candidate) => ({ candidate, match: candidate.pattern.exec(path) })).filter((entry) => entry.match);
    if (candidates.length === 0) return json(404, { error: { code: "NOT_FOUND", message: "Not found", field: null } });
    const found = candidates.find((entry) => entry.candidate.method === method);
    if (!found) return json(405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed", field: null } });

    const db = Database.open(storage);
    const ctx: Ctx = {
      db,
      now: options.now?.() ?? new Date(),
      getSession: () => readSession(storage),
      setSession: (session) => (session ? storage.set(SESSION_KEY, JSON.stringify(session)) : storage.remove(SESSION_KEY)),
      encodeImage: options.encodeImage ?? encodeImageFile,
      hashIterations: options.hashIterations ?? PBKDF2_ITERATIONS,
    };
    const params = Object.fromEntries(found.candidate.names.map((name, index) => [name, decodeURIComponent(found.match![index + 1])]));
    const input: Input = {
      params,
      query: Object.fromEntries(url.searchParams),
      json: init.json,
      form: typeof FormData !== "undefined" && init.body instanceof FormData ? init.body : null,
    };

    let response: Response;
    try {
      // Without a server to run them on a schedule, reminders and no-shows are caught up before every request.
      bookings.sweepStatuses(ctx);
      const result = await found.candidate.run(ctx, input);
      response =
        result instanceof TextBody
          ? new Response(result.text, { status: 200, headers: { "Content-Type": result.contentType, ...result.headers } })
          : json(method === "POST" && /^\/(bookings|rooms|users|maintenance)$/.test(path) ? 201 : 200, result);
    } catch (error) {
      response = errorResponse(error);
    }
    try {
      // Saved after failures too: a failed sign-in still has to count towards the lockout.
      db.save();
    } catch (error) {
      response = errorResponse(error);
    }
    return response;
  }

  return {
    request(method: string, path: string, init: { json?: unknown; body?: BodyInit | null } = {}): Promise<Response> {
      const run = queue.then(() => execute(method.toUpperCase(), path, init));
      queue = run.catch(() => undefined);
      return run;
    },
  };
}

export type Api = ReturnType<typeof createApi>;
