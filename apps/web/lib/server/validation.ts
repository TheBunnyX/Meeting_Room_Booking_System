import { z } from "zod";

// Request bodies and query strings keep the snake_case names the frontend already sends.

export const MAX_BOOKING_MS = 4 * 3_600_000;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const ROLES = ["USER", "ADMIN", "FACILITY_ADMIN"] as const;

function text(label: string, min: number, max: number) {
  const required = `${label} is required`;
  return z
    .string({ error: required })
    .min(min, min <= 1 ? required : `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);
}

const optionalText = (label: string, max: number) =>
  z.string({ error: `${label} must be text` }).max(max, `${label} must be at most ${max} characters`);

const email = z
  .string({ error: "Email is required" })
  .trim()
  .toLowerCase()
  .max(254, "Email is too long")
  .pipe(z.email("Enter a valid email address"));

const integer = (label: string, min: number, max: number) =>
  z
    .number({ error: `${label} must be a number` })
    .int(`${label} must be a whole number`)
    .min(min, `${label} must be at least ${min}`)
    .max(max, `${label} must be at most ${max}`);

/** An ISO-8601 timestamp that carries its own UTC offset. */
const awareDatetime = (label: string) =>
  z.iso
    .datetime({ offset: true, error: `${label} must be an ISO-8601 date and time with a UTC offset` })
    .transform((value) => new Date(value));

const timeOfDay = (label: string) => z.string().regex(TIME_PATTERN, `${label} must look like HH:MM`);

const imageUrl = z
  .string()
  .max(500, "Image URL must be at most 500 characters")
  .refine((value) => !value || /^(\/|https?:\/\/)/.test(value), "Image URL must be an absolute path or an http(s) URL")
  .transform((value) => value || null);

const dedupe = (items: string[]) => [...new Set(items)];

function timeRange<T extends { starts_at: Date; ends_at: Date }>(schema: z.ZodType<T>, maxDuration: boolean) {
  return schema.superRefine((value, ctx) => {
    // Individual field errors are reported first; a field that failed is not a Date here.
    if (!(value.starts_at instanceof Date) || !(value.ends_at instanceof Date)) return;
    if (value.ends_at <= value.starts_at) {
      ctx.addIssue({ code: "custom", message: "End time must be after start time", path: ["ends_at"] });
    } else if (maxDuration && value.ends_at.getTime() - value.starts_at.getTime() > MAX_BOOKING_MS) {
      ctx.addIssue({ code: "custom", message: "A booking cannot exceed 4 hours", path: ["ends_at"] });
    }
  });
}

export const loginSchema = z.object({
  email,
  password: text("Password", 1, 128),
});

export const changePasswordSchema = z.object({
  current_password: text("Current password", 1, 128),
  new_password: text("New password", 8, 128),
});

export const forgotPasswordSchema = z.object({ email });

export const userCreateSchema = z.object({
  email,
  full_name: text("Full name", 2, 150),
  department: optionalText("Department", 100).nullish(),
  team: optionalText("Team", 100).nullish(),
  role: z.enum(ROLES).default("USER"),
});

export const userUpdateSchema = z.object({
  full_name: text("Full name", 2, 150).optional(),
  department: optionalText("Department", 100).nullish(),
  team: optionalText("Team", 100).nullish(),
  role: z.enum(ROLES).optional(),
  is_active: z.boolean().optional(),
});

const roomShape = {
  name: text("Name", 2, 120),
  building: text("Building", 1, 100),
  floor: text("Floor", 1, 30),
  capacity: integer("Capacity", 1, 1000),
  image_url: imageUrl.nullish(),
  opens_at: timeOfDay("Opening time"),
  closes_at: timeOfDay("Closing time"),
  requires_approval: z.boolean(),
  facility_ids: z.array(z.number().int()).max(100),
};

export const roomInputSchema = z
  .object({
    ...roomShape,
    opens_at: roomShape.opens_at.default("08:00"),
    closes_at: roomShape.closes_at.default("18:00"),
    requires_approval: roomShape.requires_approval.default(false),
    facility_ids: roomShape.facility_ids.default([]),
  })
  .refine((value) => value.closes_at > value.opens_at, {
    error: "Closing time must be after opening time",
    path: ["closes_at"],
  });

export const roomUpdateSchema = z.object({
  name: roomShape.name.optional(),
  building: roomShape.building.optional(),
  floor: roomShape.floor.optional(),
  capacity: roomShape.capacity.optional(),
  image_url: roomShape.image_url,
  opens_at: roomShape.opens_at.optional(),
  closes_at: roomShape.closes_at.optional(),
  requires_approval: roomShape.requires_approval.optional(),
  facility_ids: roomShape.facility_ids.nullish(),
  is_active: z.boolean().optional(),
});

export const bookingInputSchema = timeRange(
  z.object({
    room_id: integer("Room", 1, 2_147_483_647),
    title: text("Title", 2, 200),
    description: optionalText("Description", 2000).nullish(),
    attendee_count: integer("Attendee count", 1, 1000),
    starts_at: awareDatetime("Start time"),
    ends_at: awareDatetime("End time"),
    participant_emails: z.array(email).max(100, "At most 100 participants").default([]).transform(dedupe),
    recurrence_rule: z.literal("weekly").nullish(),
  }),
  true,
);

export const bookingUpdateSchema = z
  .object({
    room_id: integer("Room", 1, 2_147_483_647).optional(),
    title: text("Title", 2, 200).optional(),
    description: optionalText("Description", 2000).nullish(),
    attendee_count: integer("Attendee count", 1, 1000).optional(),
    starts_at: awareDatetime("Start time").optional(),
    ends_at: awareDatetime("End time").optional(),
    participant_emails: z.array(email).max(100, "At most 100 participants").transform(dedupe).nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.starts_at instanceof Date && value.ends_at instanceof Date) {
      if (value.ends_at <= value.starts_at) {
        ctx.addIssue({ code: "custom", message: "End time must be after start time", path: ["ends_at"] });
      } else if (value.ends_at.getTime() - value.starts_at.getTime() > MAX_BOOKING_MS) {
        ctx.addIssue({ code: "custom", message: "A booking cannot exceed 4 hours", path: ["ends_at"] });
      }
    }
  });

export const rejectSchema = z.object({
  reason: z.string({ error: "Reason is required" }).trim().min(2, "Reason must be at least 2 characters").max(300),
});

export const checkInCodeSchema = z.object({
  token: text("Code", 10, 2000),
});

export const maintenanceInputSchema = timeRange(
  z.object({
    room_id: integer("Room", 1, 2_147_483_647),
    starts_at: awareDatetime("Start time"),
    ends_at: awareDatetime("End time"),
    reason: text("Reason", 2, 300),
  }),
  false,
);

const queryInt = (label: string, min: number, max?: number) => {
  let schema = z.coerce.number({ error: `${label} must be a number` }).int(`${label} must be a whole number`).min(min, `${label} must be at least ${min}`);
  if (max !== undefined) schema = schema.max(max, `${label} must be at most ${max}`);
  return schema;
};

const queryBoolean = z.enum(["true", "false"]).transform((value) => value === "true");

export const pageQuerySchema = z.object({
  limit: queryInt("limit", 1, 200).default(100),
  offset: queryInt("offset", 0).default(0),
});

export const searchQuerySchema = z.object({ q: z.string().max(100).default("") });

export const roomsQuerySchema = z.object({
  capacity: queryInt("capacity", 1).optional(),
  building: z.string().optional(),
  include_inactive: queryBoolean.optional(),
});

export const availabilityQuerySchema = z.object({
  starts_at: awareDatetime("starts_at"),
  ends_at: awareDatetime("ends_at"),
  capacity: queryInt("capacity", 1).optional(),
  building: z.string().optional(),
  facility_ids: z.string().optional(),
});

export const periodRequiredQuerySchema = z.object({
  starts_at: awareDatetime("starts_at"),
  ends_at: awareDatetime("ends_at"),
});

export const periodOptionalQuerySchema = z.object({
  starts_at: awareDatetime("starts_at").optional(),
  ends_at: awareDatetime("ends_at").optional(),
});

export const notificationsQuerySchema = z.object({ limit: queryInt("limit", 1, 100).default(20) });

export const auditQuerySchema = z.object({
  limit: queryInt("limit", 1, 200).default(50),
  offset: queryInt("offset", 0).default(0),
  entity: z.string().max(100).optional(),
});

export type BookingInput = z.output<typeof bookingInputSchema>;
export type BookingUpdate = z.output<typeof bookingUpdateSchema>;
export type RoomInput = z.output<typeof roomInputSchema>;
export type RoomUpdate = z.output<typeof roomUpdateSchema>;
export type UserCreate = z.output<typeof userCreateSchema>;
export type UserUpdate = z.output<typeof userUpdateSchema>;
export type MaintenanceInput = z.output<typeof maintenanceInputSchema>;
