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
  const { color: moodColor } =
    LITT_MOOD_COLORS[mood] ?? LITT_MOOD_COLORS.happy;

  const isThinking = mood === "thinking";
  const isExcited = mood === "excited";

  return (
    <div className="relative flex flex-col items-center gap-3">
      <div
        style={{
          width: size,
          height: size * 1.15,
          position: "relative",
          animation: isExcited
            ? "litt-bounce 0.5s ease-in-out infinite alternate"
            : "litt-breathe 3s ease-in-out infinite",
        }}
      >
        <svg
          width={size}
          height={size * 1.15}
          viewBox="0 0 320 368"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id={`litt-helmet-${mood}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#f0f0f0" />
              <stop offset="60%" stopColor="#e0e0e0" />
              <stop offset="100%" stopColor="#c0c0c0" />
            </linearGradient>
            <linearGradient id={`litt-body-${mood}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#1a1a22" />
              <stop offset="100%" stopColor="#0d0d14" />
            </linearGradient>
            <radialGradient id={`litt-visor-${mood}`} cx="45%" cy="40%">
              <stop offset="0%" stopColor="#1a1a2e" />
              <stop offset="100%" stopColor="#07070f" />
            </radialGradient>
            <filter id={`litt-glow-${mood}`} x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id={`litt-softshadow-${mood}`} x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#000" floodOpacity="0.5" />
            </filter>
          </defs>

          {/* ── GROUND GLOW ── */}
          <ellipse cx="160" cy="355" rx="70" ry="10" fill={moodColor} opacity="0.18" filter={`url(#litt-glow-${mood})`} />

          {/* ── BODY / HOODIE ── */}
          {/* Main torso */}
          <path d="M95 210 Q80 215 72 240 L68 310 Q68 320 80 320 L240 320 Q252 320 252 310 L248 240 Q240 215 225 210 Z"
            fill={`url(#litt-body-${mood})`} filter={`url(#litt-softshadow-${mood})`} />
          {/* Hoodie neon trim bottom */}
          <path d="M68 310 Q68 322 80 322 L240 322 Q252 322 252 310 L248 308 L72 308 Z" fill={moodColor} opacity="0.4" />
          {/* Circuit lines on body */}
          <path d="M110 230 L110 290 M110 260 L130 260 M130 260 L130 290" stroke={moodColor} strokeWidth="1" opacity="0.3" strokeLinecap="round" />
          <path d="M185 235 L185 280 M175 260 L195 260" stroke={moodColor} strokeWidth="1" opacity="0.25" strokeLinecap="round" />
          {/* LiT chest text */}
          <rect x="132" y="248" width="56" height="26" rx="6" fill="#07070f" stroke={moodColor} strokeWidth="1.5" opacity="0.9" />
          <text x="160" y="265" textAnchor="middle" fontSize="13" fontWeight="800" fill={moodColor} fontFamily="Arial Black, sans-serif">LiT</text>
          {/* Hoodie front zipper line */}
          <line x1="160" y1="210" x2="160" y2="320" stroke={moodColor} strokeWidth="1" opacity="0.2" strokeDasharray="4 3" />
          {/* Left neon strip */}
          <rect x="90" y="215" width="4" height="80" rx="2" fill={moodColor} opacity="0.5" />
          {/* Right neon strip */}
          <rect x="226" y="215" width="4" height="80" rx="2" fill={moodColor} opacity="0.5" />

          {/* ── LEFT ARM ── */}
          <path d="M95 215 Q60 220 50 255 Q44 275 52 295 Q58 310 72 308 L85 280 Q90 260 98 240 Z"
            fill="#18181f" stroke={moodColor} strokeWidth="1" strokeOpacity="0.3" />
          {/* Left hand */}
          <ellipse cx="55" cy="302" rx="14" ry="11" fill="#e8e8e8" />
          {/* Left glove glow */}
          <ellipse cx="55" cy="302" rx="14" ry="11" fill={moodColor} opacity="0.2" filter={`url(#litt-glow-${mood})`} />
          {/* Peace / pointing finger */}
          {isThinking ? (
            <>
              <rect x="47" y="288" width="6" height="14" rx="3" fill="#e8e8e8" />
              <rect x="55" y="285" width="6" height="17" rx="3" fill="#e8e8e8" />
            </>
          ) : (
            <>
              <rect x="46" y="286" width="6" height="16" rx="3" fill="#e8e8e8" />
              <rect x="54" y="284" width="6" height="18" rx="3" fill="#e8e8e8" />
              <rect x="62" y="288" width="5" height="14" rx="3" fill="#e8e8e8" />
            </>
          )}

          {/* ── RIGHT ARM ── */}
          <path d="M225 215 Q260 220 270 255 Q276 275 268 295 Q262 310 248 308 L235 280 Q230 260 222 240 Z"
            fill="#18181f" stroke={moodColor} strokeWidth="1" strokeOpacity="0.3" />
          {/* Right hand */}
          <ellipse cx="265" cy="302" rx="14" ry="11" fill="#e8e8e8" />
          <ellipse cx="265" cy="302" rx="14" ry="11" fill={moodColor} opacity="0.2" filter={`url(#litt-glow-${mood})`} />
          <rect x="257" y="288" width="6" height="14" rx="3" fill="#e8e8e8" />
          <rect x="265" y="290" width="6" height="12" rx="3" fill="#e8e8e8" />

          {/* ── LEGS / PANTS ── */}
          <path d="M110 318 L100 360 Q98 365 110 365 L145 365 Q152 365 150 358 L148 318 Z" fill="#111118" />
          <path d="M210 318 L220 360 Q222 365 210 365 L175 365 Q168 365 170 358 L172 318 Z" fill="#111118" />
          {/* Neon trim on pants */}
          <path d="M100 360 Q98 365 110 365 L145 365" stroke={moodColor} strokeWidth="1.5" opacity="0.5" fill="none" />
          <path d="M220 360 Q222 365 210 365 L175 365" stroke={moodColor} strokeWidth="1.5" opacity="0.5" fill="none" />

          {/* ── SNEAKERS ── */}
          {/* Left sneaker */}
          <rect x="90" y="356" width="58" height="16" rx="8" fill="#f0f0f0" />
          <rect x="90" y="356" width="58" height="7" rx="4" fill={moodColor} opacity="0.3" />
          <text x="119" y="368" textAnchor="middle" fontSize="5" fill="#333" fontFamily="Arial, sans-serif" fontWeight="700">LiTTree</text>
          {/* Right sneaker */}
          <rect x="172" y="356" width="58" height="16" rx="8" fill="#f0f0f0" />
          <rect x="172" y="356" width="58" height="7" rx="4" fill={moodColor} opacity="0.3" />
          <text x="201" y="368" textAnchor="middle" fontSize="5" fill="#333" fontFamily="Arial, sans-serif" fontWeight="700">LiTTree</text>
          {/* Sneaker glow */}
          <ellipse cx="119" cy="367" rx="25" ry="4" fill={moodColor} opacity="0.25" filter={`url(#litt-glow-${mood})`} />
          <ellipse cx="201" cy="367" rx="25" ry="4" fill={moodColor} opacity="0.25" filter={`url(#litt-glow-${mood})`} />

          {/* ── NECK ── */}
          <rect x="144" y="195" width="32" height="22" rx="6" fill="#0d0d14" />

          {/* ── HELMET ── */}
          {/* Outer shell */}
          <ellipse cx="160" cy="140" rx="88" ry="86"
            fill={`url(#litt-helmet-${mood})`} filter={`url(#litt-softshadow-${mood})`} />
          {/* Helmet highlight */}
          <ellipse cx="135" cy="100" rx="28" ry="18" fill="rgba(255,255,255,0.25)" transform="rotate(-20 135 100)" />
          {/* Helmet neon trim ring */}
          <ellipse cx="160" cy="140" rx="88" ry="86" fill="none" stroke={moodColor} strokeWidth="2" opacity="0.5" />
          {/* LiTTree LabStudios text on helmet */}
          <text x="160" y="82" textAnchor="middle" fontSize="9" fontWeight="700" fill="#1a1a1a" fontFamily="Arial, sans-serif">LiTTree</text>
          <text x="160" y="93" textAnchor="middle" fontSize="7" fontWeight="500" fill="#333" fontFamily="Arial, sans-serif">LabStudios</text>

          {/* Visor */}
          <path d="M88 148 Q88 88 160 88 Q232 88 232 148 Q232 175 200 182 L120 182 Q88 175 88 148 Z"
            fill={`url(#litt-visor-${mood})`} stroke="#2a2a35" strokeWidth="2" />
          {/* Visor glass reflection */}
          <path d="M105 112 Q140 98 190 106" stroke="rgba(255,255,255,0.1)" strokeWidth="4" strokeLinecap="round" fill="none" />
          <path d="M100 128 Q125 118 155 122" stroke="rgba(255,255,255,0.06)" strokeWidth="2" strokeLinecap="round" fill="none" />

          {/* Eyes */}
          <g filter={`url(#litt-glow-${mood})`}>
            <AvatarEye mood={mood} cx={133} cy={148} color={moodColor} />
            <AvatarEye mood={mood} cx={187} cy={148} color={moodColor} />
          </g>

          {/* Mouth */}
          <path d={getAvatarMouthPath(mood)} stroke={moodColor} strokeWidth="3"
            strokeLinecap="round" fill="none" filter={`url(#litt-glow-${mood})`} />

          {/* LiT headphone badge right */}
          <circle cx="244" cy="145" r="16" fill="#0d0d14" stroke={moodColor} strokeWidth="2" />
          <text x="244" y="149" textAnchor="middle" fontSize="8" fontWeight="800" fill={moodColor} fontFamily="Arial Black, sans-serif">LiT</text>
          {/* Headphone band */}
          <path d="M160 55 Q244 52 244 130" fill="none" stroke="#2a2a35" strokeWidth="6" strokeLinecap="round" />

          {/* Flask badge left shoulder */}
          <g transform="translate(62,195)">
            <circle cx="12" cy="12" r="12" fill="#0d0d14" stroke={moodColor} strokeWidth="1.5" />
            <path d="M9 16 L9 10 L11 10 L11 7 L13 7 L13 10 L15 10 L15 16 Q12 18 9 16 Z" fill={moodColor} opacity="0.85" />
          </g>

          {/* Hoodie hood top curve */}
          <path d="M86 145 Q88 68 160 62 Q232 68 234 145" fill="#18181f" stroke={moodColor} strokeWidth="1" strokeOpacity="0.3" />

          {/* Love cheeks */}
          {mood === "love" && (
            <>
              <circle cx="108" cy="166" r="8" fill="#ff6b8a" opacity="0.35" />
              <circle cx="212" cy="166" r="8" fill="#ff6b8a" opacity="0.35" />
            </>
          )}

          {/* Thinking indicator */}
          {isThinking && (
            <>
              <circle cx="248" cy="88" r="5" fill={moodColor} opacity="0.9" />
              <circle cx="264" cy="74" r="7" fill={moodColor} opacity="0.7" />
              <circle cx="282" cy="58" r="9" fill={moodColor} opacity="0.5" />
            </>
          )}
        </svg>
      </div>

      {/* Inline keyframe animations */}
      <style>{`
        @keyframes litt-breathe {
          0%, 100% { transform: translateY(0px) scaleY(1); }
          50% { transform: translateY(-4px) scaleY(1.01); }
        }
        @keyframes litt-bounce {
          0% { transform: translateY(0px) rotate(-2deg); }
          100% { transform: translateY(-8px) rotate(2deg); }
        }
      `}</style>

      {showBadge && <LiTTMoodBadge mood={mood} />}
    </div>
  );
}

function AvatarEye({
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
  if (mood === "wink" && cx > 160) {
    return <path d={`M${cx - 12} ${cy} Q${cx} ${cy - 7} ${cx + 12} ${cy}`} stroke={color} strokeWidth="3" strokeLinecap="round" fill="none" />;
  }
  if (mood === "sleepy") {
    return <path d={`M${cx - 12} ${cy} Q${cx} ${cy + 5} ${cx + 12} ${cy}`} stroke={color} strokeWidth="3" strokeLinecap="round" fill="none" />;
  }
  if (mood === "surprised") {
    return <circle cx={cx} cy={cy} r="9" fill={color} />;
  }
  if (mood === "thinking") {
    return <circle cx={cx} cy={cy} r="7" fill={color} opacity="0.85" />;
  }
  return <path d={`M${cx - 12} ${cy} Q${cx} ${cy - 12} ${cx + 12} ${cy}`} stroke={color} strokeWidth="4" strokeLinecap="round" fill="none" />;
}

function getAvatarMouthPath(mood: LiTTMood): string {
  switch (mood) {
    case "happy":
    case "excited":
    case "love":
      return "M130 168 Q160 185 190 168";
    case "focused":
    case "thinking":
      return "M146 174 Q160 176 174 174";
    case "wink":
    case "cheeky":
      return "M136 174 Q162 178 186 168";
    case "surprised":
      return "M150 168 Q160 158 170 168 Q160 180 150 168";
    case "sleepy":
      return "M140 176 Q160 170 180 176";
    default:
      return "M130 168 Q160 185 190 168";
  }
}
