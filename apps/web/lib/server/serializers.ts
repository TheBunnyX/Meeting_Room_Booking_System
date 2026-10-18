import type { AuditLog, Booking, BookingParticipant, Facility, Maintenance, Notification, Room, User } from "@prisma/client";

// API responses keep the snake_case shape of the original backend. Only listed fields are
// exposed, so sensitive columns such as password_hash can never leak by accident.

export type RoomWithFacilities = Room & { facilities: Facility[] };
export type BookingWithRelations = Booking & { room: Room; organizer: User; participants: BookingParticipant[] };

export const userRead = (user: User) => ({
  id: user.id,
  email: user.email,
  full_name: user.fullName,
  department: user.department,
  team: user.team,
  role: user.role,
  is_active: user.isActive,
  must_change_password: user.mustChangePassword,
});

export const directoryRead = (user: User) => ({ id: user.id, email: user.email, full_name: user.fullName });

export const roomRead = (room: RoomWithFacilities) => ({
  id: room.id,
  name: room.name,
  building: room.building,
  floor: room.floor,
  capacity: room.capacity,
  image_url: room.imageUrl,
  opens_at: room.opensAt,
  closes_at: room.closesAt,
  requires_approval: room.requiresApproval,
  is_active: room.isActive,
  facility_ids: room.facilities.map((facility) => facility.id),
  facility_names: room.facilities.map((facility) => facility.name),
});

export const bookingRead = (booking: BookingWithRelations) => ({
  id: booking.id,
  room_id: booking.roomId,
  title: booking.title,
  description: booking.description,
  attendee_count: booking.attendeeCount,
  starts_at: booking.startsAt,
  ends_at: booking.endsAt,
  status: booking.status,
  room_name: booking.room.name,
  organizer_name: booking.organizer.fullName,
  participant_emails: booking.participants.map((participant) => participant.email),
  checked_in_at: booking.checkedInAt,
  series_id: booking.seriesId,
  decision_note: booking.decisionNote,
});

export const scheduleBookingRead = (booking: Booking & { room: Room; organizer: User }) => ({
  id: booking.id,
  room_id: booking.roomId,
  title: booking.title,
  starts_at: booking.startsAt,
  ends_at: booking.endsAt,
  status: booking.status,
  room_name: booking.room.name,
  organizer_name: booking.organizer.fullName,
});

export const maintenanceRead = (item: Maintenance & { room: Room }) => ({
  id: item.id,
  room_id: item.roomId,
  starts_at: item.startsAt,
  ends_at: item.endsAt,
  reason: item.reason,
  room_name: item.room.name,
});

export const notificationRead = (item: Notification) => ({
  id: item.id,
  title: item.title,
  message: item.message,
  link: item.link,
  is_read: item.isRead,
  created_at: item.createdAt,
});

export const auditLogRead = (log: AuditLog, actor: User | null) => ({
  id: log.id,
  created_at: log.createdAt,
  actor_name: actor?.fullName ?? null,
  actor_email: actor?.email ?? null,
  action: log.action,
  entity: log.entity,
  entity_id: log.entityId,
  details: log.details,
});

export const checkInRead = (booking: BookingWithRelations, created: boolean) => ({
  message: created ? "Check-in successful" : "Already checked in",
  checked_in_at: booking.checkedInAt,
  booking_id: booking.id,
  title: booking.title,
  room_name: booking.room.name,
});
