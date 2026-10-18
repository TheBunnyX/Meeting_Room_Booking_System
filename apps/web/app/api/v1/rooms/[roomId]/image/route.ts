import { NextResponse } from "next/server";

import { AppError } from "@/lib/server/errors";
import { parseId, route } from "@/lib/server/route";
import { requireRoles } from "@/lib/server/security";
import { roomRead } from "@/lib/server/serializers";
import { MAX_ROOM_IMAGE_BYTES, deleteRoomImage, replaceRoomImage } from "@/lib/server/services/rooms";

export const POST = route<{ roomId: string }>(async (request, { roomId }) => {
  await requireRoles(request, "ADMIN", "FACILITY_ADMIN");
  const id = parseId(roomId, "room_id");
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new AppError(422, "VALIDATION_ERROR", "Upload the image as multipart form data", "image");
  }
  const image = form.get("image");
  if (!(image instanceof File)) throw new AppError(422, "VALIDATION_ERROR", "An image file is required", "image");
  // Checked before reading the file so an oversized upload is rejected without buffering it.
  if (image.size > MAX_ROOM_IMAGE_BYTES) {
    throw new AppError(413, "IMAGE_TOO_LARGE", "Room images must be 4 MB or smaller", "image");
  }
  const room = await replaceRoomImage(id, image.type, new Uint8Array(await image.arrayBuffer()));
  return NextResponse.json(roomRead(room));
});

export const DELETE = route<{ roomId: string }>(async (request, { roomId }) => {
  await requireRoles(request, "ADMIN", "FACILITY_ADMIN");
  return NextResponse.json(roomRead(await deleteRoomImage(parseId(roomId, "room_id"))));
});
