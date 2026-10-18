"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { apiFetch, errorMessage } from "../../lib/api";
import { appOrigin, isLoopbackOrigin } from "../../lib/url";
import type { CheckInToken } from "../../lib/types";

// The code lives 120 seconds; renewing every 30 keeps a freshly scanned one well inside its lifetime.
const REFRESH_MS = 30_000;

/**
 * Full-screen check-in code for a room. Leave it open on a tablet or monitor at the room, signed in
 * as an admin: it shows a QR code that renews itself, so only someone who can see the screen can
 * scan a code that still works.
 */
export function CheckInScreen() {
  const [roomName, setRoomName] = useState("");
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    const roomId = Number(new URLSearchParams(window.location.search).get("room"));
    if (!Number.isInteger(roomId) || roomId <= 0) {
      setError("Open this screen from Rooms & people → Check-in screen.");
      return;
    }
    // NEXT_PUBLIC_* values must be referenced literally so Next.js can inline them.
    const base = appOrigin(process.env.NEXT_PUBLIC_APP_URL, window.location.origin);
    setOrigin(base);
    let cancelled = false;
    let timer: number | undefined;

    async function renew() {
      try {
        const issued = await apiFetch<CheckInToken>(`/api/v1/rooms/${roomId}/check-in-token`);
        const link = `${base}/check-in?room=${roomId}&t=${encodeURIComponent(issued.token)}`;
        const picture = await QRCode.toDataURL(link, { width: 640, margin: 2, errorCorrectionLevel: "M" });
        if (cancelled) return;
        setRoomName(issued.room_name);
        setImage(picture);
        setError("");
      } catch (reason) {
        // A 401 is already on its way to the sign-in page; otherwise keep trying.
        if (!cancelled && (reason as { status?: number })?.status !== 401) {
          setError(errorMessage(reason, "The code could not be refreshed."));
        }
      }
      if (!cancelled) timer = window.setTimeout(renew, REFRESH_MS);
    }

    void renew();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return <main className="checkin-screen">
    <p className="eyebrow">Room check-in</p>
    <h1>{roomName || "Check-in"}</h1>
    {image
      // eslint-disable-next-line @next/next/no-img-element -- generated in the browser as a data URL
      ? <img className="checkin-qr" src={image} alt={`QR code to check in to ${roomName}`} />
      : !error && <p className="empty" role="status">Generating the code…</p>}
    {image && <p className="checkin-help">Scan with your phone to check in to your booking.<br />The code renews itself every {REFRESH_MS / 1000} seconds.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {origin && isLoopbackOrigin(origin) && <p className="checkin-warning" role="alert">
      This code points to <strong>{origin}</strong>, which only works on this computer. Open this screen from the address people use to reach the site, or set <code>NEXT_PUBLIC_APP_URL</code>.
    </p>}
  </main>;
}
