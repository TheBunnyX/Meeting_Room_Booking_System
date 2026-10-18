import { del, list, put } from "@vercel/blob";

import { AppError } from "./errors";

const ROOM_IMAGE_PREFIX = "rooms/";
const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

function requireToken() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new AppError(
      503,
      "STORAGE_NOT_CONFIGURED",
      "Image storage is not configured. Connect a Vercel Blob store (BLOB_READ_WRITE_TOKEN).",
    );
  }
}

/** Only images this app uploaded are ever deleted; bundled and external image URLs are left alone. */
export function isStoredRoomImage(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.endsWith(BLOB_HOST_SUFFIX) &&
      parsed.pathname.startsWith(`/${ROOM_IMAGE_PREFIX}`)
    );
  } catch {
    return false;
  }
}

/** Store a room image in Vercel Blob and return its public URL. */
export async function uploadRoomImage(filename: string, content: Uint8Array, contentType: string) {
  requireToken();
  const blob = await put(`${ROOM_IMAGE_PREFIX}${filename}`, Buffer.from(content), {
    access: "public",
    contentType,
    addRandomSuffix: false,
  });
  return blob.url;
}

/** Best effort: a failed delete only leaves an unreferenced file behind, so it never fails a request. */
export async function removeRoomImage(url: string | null | undefined) {
  if (!isStoredRoomImage(url) || !process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    await del(url);
  } catch (error) {
    console.error("Could not delete room image", error);
  }
}

/** Demo reset: remove every uploaded room image. */
export async function removeAllRoomImages() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: ROOM_IMAGE_PREFIX, cursor });
    if (page.blobs.length > 0) await del(page.blobs.map((blob) => blob.url));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}
