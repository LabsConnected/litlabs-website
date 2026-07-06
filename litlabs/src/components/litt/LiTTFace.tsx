"use client";

import { LiTTMood } from "@/lib/ai/litt-router";
import { LiTTMoodBadge } from "./LiTTMoodBadge";
import { LITT_MOOD_COLORS } from "./litt-theme";

interface LiTTFaceProps {
  mood: LiTTMood;
  size?: number;
  showBadge?: boolean;
}

export function LiTTFace({
  mood,
  size = 180,
  showBadge = true,
}: LiTTFaceProps) {
  const { color: moodColor, glow } =
    LITT_MOOD_COLORS[mood] ?? LITT_MOOD_COLORS.happy;

  return (
    <div className="relative flex flex-col items-center gap-3">
      <div
        className="relative flex items-center justify-center rounded-full"
        style={{
          width: size,
          height: size,
          background: `radial-gradient(circle, ${glow} 0%, transparent 70%)`,
          boxShadow: `0 0 50px ${glow}`,
        }}
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 220 220"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="drop-shadow-2xl"
        >
          <defs>
            <linearGradient id="helmet" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#d4d4d8" />
            </linearGradient>
            <linearGradient id="visor" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0a0a0f" />
              <stop offset="100%" stopColor="#15151c" />
            </linearGradient>
            <radialGradient id="eyeGlow">
              <stop offset="0%" stopColor={moodColor} />
              <stop offset="100%" stopColor={moodColor} stopOpacity="0.2" />
            </radialGradient>
            <filter id="greenGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Helmet outer ring */}
          <circle
            cx="110"
            cy="110"
            r="94"
            fill="url(#helmet)"
            stroke="#2a2a35"
            strokeWidth="3"
          />

          {/* Helmet inner ring / visor bezel */}
          <circle
            cx="110"
            cy="110"
            r="78"
            fill="#0f0f14"
            stroke="#2a2a35"
            strokeWidth="2"
          />

          {/* Visor */}
          <path
            d="M42 110 Q42 50 110 50 Q178 50 178 110 Q178 130 150 138 L70 138 Q42 130 42 110 Z"
            fill="url(#visor)"
            stroke="#2a2a35"
            strokeWidth="2"
          />

          {/* Visor reflection */}
          <path
            d="M60 80 Q90 65 130 70"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
          />

          {/* Eyes */}
          <g filter="url(#greenGlow)">
            <Eye mood={mood} cx={82} cy={108} color={moodColor} />
            <Eye mood={mood} cx={138} cy={108} color={moodColor} />
          </g>

          {/* Mouth / expression */}
          <path
            d={getMouthPath(mood)}
            stroke={moodColor}
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
            filter="url(#greenGlow)"
          />

          {/* Heart cheeks for love */}
          {mood === "love" && (
            <>
              <path
                d="M48 128 Q52 122 56 128 Q52 136 48 128"
                fill="#ff6b8a"
                opacity="0.6"
              />
              <path
                d="M164 128 Q168 122 172 128 Q168 136 164 128"
                fill="#ff6b8a"
                opacity="0.6"
              />
            </>
          )}

          {/* LiT chest badge */}
          <g transform="translate(92, 175)">
            <rect
              x="0"
              y="0"
              width="36"
              height="18"
              rx="4"
              fill="#0f0f14"
              stroke="#2a2a35"
              strokeWidth="1"
            />
            <text
              x="18"
              y="12"
              textAnchor="middle"
              fontSize="10"
              fontWeight="700"
              fill={moodColor}
              fontFamily="Arial, sans-serif"
            >
              LiT
            </text>
          </g>

          {/* Flask shoulder badge */}
          <g transform="translate(166, 150)">
            <circle
              cx="10"
              cy="10"
              r="10"
              fill="#0f0f14"
              stroke={moodColor}
              strokeWidth="1"
            />
            <path
              d="M7 14 L7 8 L9 8 L9 5 L11 5 L11 8 L13 8 L13 14 Q10 16 7 14 Z"
              fill={moodColor}
              opacity="0.8"
            />
          </g>
        </svg>
      </div>
      {showBadge && <LiTTMoodBadge mood={mood} />}
    </div>
  );
}

function Eye({
  mood,
  cx,
  cy,
  color,
}: {
  mood: LiTTMood;
  cx: number;
  cy: number;
  color: string;
}) {
  if (mood === "wink") {
    // Only wink the right eye
    if (cx > 100) {
      return (
        <path
          d={`M${cx - 10} ${cy} Q${cx} ${cy - 6} ${cx + 10} ${cy}`}
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
      );
    }
  }
  if (mood === "sleepy") {
    return (
      <path
        d={`M${cx - 10} ${cy} Q${cx} ${cy + 4} ${cx + 10} ${cy}`}
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
    );
  }
  if (mood === "surprised") {
    return <circle cx={cx} cy={cy} r="7" fill={color} />;
  }
  if (mood === "thinking") {
    return <circle cx={cx} cy={cy} r="6" fill={color} opacity="0.8" />;
  }
  // happy / excited / focused / cheeky / love / default
  return (
    <path
      d={`M${cx - 10} ${cy} Q${cx} ${cy - 10} ${cx + 10} ${cy}`}
      stroke={color}
      strokeWidth="4"
      strokeLinecap="round"
      fill="none"
    />
  );
}

function getMouthPath(mood: LiTTMood): string {
  switch (mood) {
    case "happy":
    case "excited":
    case "love":
      return "M78 148 Q110 168 142 148";
    case "focused":
    case "thinking":
      return "M95 158 Q110 160 125 158";
    case "wink":
    case "cheeky":
      return "M85 158 Q110 162 135 150";
    case "surprised":
      return "M100 150 Q110 140 120 150 Q110 165 100 150";
    case "sleepy":
      return "M90 160 Q110 152 130 160";
    default:
      return "M78 148 Q110 168 142 148";
  }
}
