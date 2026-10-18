import { ImageResponse } from "next/og";

export const alt = "MeetingHub: meeting room booking";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The social preview shown when a link to the site is shared.
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#fbfbfa",
          color: "#151515",
          padding: 80,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              background: "#151515",
              color: "#d9f25a",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 40,
              fontWeight: 800,
            }}
          >
            M
          </div>
          <div style={{ fontSize: 40, fontWeight: 700 }}>MeetingHub</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 88, fontWeight: 800, lineHeight: 1.05, letterSpacing: -3 }}>
            Make space for good work.
          </div>
          <div style={{ fontSize: 34, color: "#737373" }}>
            Find a room, book it in seconds, and check in with a QR code.
          </div>
        </div>
        <div style={{ height: 12, width: 220, background: "#d9f25a", borderRadius: 6 }} />
      </div>
    ),
    size,
  );
}
