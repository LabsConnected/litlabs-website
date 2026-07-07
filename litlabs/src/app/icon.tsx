import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          background:
            "radial-gradient(circle at 30% 25%, #22d3ee 0%, #0f172a 42%, #020617 100%)",
          borderRadius: 10,
          border: "1px solid rgba(34,211,238,0.35)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#e0f2fe",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.05)",
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 17.5L12 4l3 7h5l-8 13-3-7H4z" fill="currentColor" />
        </svg>
      </div>
    ),
    size,
  );
}
