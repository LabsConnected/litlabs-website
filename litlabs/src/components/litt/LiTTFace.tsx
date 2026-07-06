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
  const isSleepy = mood === "sleepy";
  const isLove = mood === "love";

  const uid = mood;

  return (
    <div className="relative flex flex-col items-center gap-3">
      <div
        style={{
          width: size,
          height: size * 1.25,
          position: "relative",
          filter: `drop-shadow(0 0 ${size * 0.08}px ${moodColor}55)`,
          animation: isExcited
            ? "litt-bounce 0.45s ease-in-out infinite alternate"
            : isSleepy
            ? "litt-sway 4s ease-in-out infinite"
            : "litt-breathe 3.5s ease-in-out infinite",
        }}
      >
        <svg
          width={size}
          height={size * 1.25}
          viewBox="0 0 340 425"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* Helmet gradient — white/silver like reference */}
            <linearGradient id={`hg-${uid}`} x1="0.2" y1="0" x2="0.8" y2="1">
              <stop offset="0%" stopColor="#f8f8f8" />
              <stop offset="50%" stopColor="#e2e2e2" />
              <stop offset="100%" stopColor="#c8c8c8" />
            </linearGradient>
            {/* Hood gradient — dark with neon edge */}
            <linearGradient id={`hood-${uid}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#1c1c24" />
              <stop offset="100%" stopColor="#111118" />
            </linearGradient>
            {/* Visor — deep dark with slight reflection */}
            <radialGradient id={`visor-${uid}`} cx="40%" cy="35%" r="65%">
              <stop offset="0%" stopColor="#12122a" />
              <stop offset="100%" stopColor="#05050e" />
            </radialGradient>
            {/* Body hoodie gradient */}
            <linearGradient id={`body-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1a1a24" />
              <stop offset="100%" stopColor="#0e0e18" />
            </linearGradient>
            {/* Chest badge gradient */}
            <linearGradient id={`chest-${uid}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#0d0d18" />
              <stop offset="100%" stopColor="#050510" />
            </linearGradient>
            {/* Sneaker white */}
            <linearGradient id={`shoe-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#e8e8e8" />
            </linearGradient>
            {/* Glow filter for eyes/neon */}
            <filter id={`glow-${uid}`} x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            {/* Soft outer glow */}
            <filter id={`outerglow-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            {/* Drop shadow */}
            <filter id={`shadow-${uid}`} x="-15%" y="-15%" width="130%" height="130%">
              <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#000" floodOpacity="0.6" />
            </filter>
          </defs>

          {/* ── GROUND GLOW ── */}
          <ellipse cx="170" cy="415" rx="80" ry="10" fill={moodColor} opacity="0.2" filter={`url(#glow-${uid})`} />

          {/* ── HOODIE HOOD (behind helmet) ── */}
          <path d="M65 175 Q55 80 170 55 Q285 80 275 175 Q280 160 290 175 Q295 105 170 42 Q45 105 50 175 Z"
            fill={`url(#hood-${uid})`} />
          {/* Hood neon edge trim */}
          <path d="M65 175 Q55 80 170 55 Q285 80 275 175"
            fill="none" stroke={moodColor} strokeWidth="2" strokeOpacity="0.55" />
          {/* Hood heartbeat/EKG line across top */}
          <path d="M105 65 L120 65 L125 58 L133 75 L141 52 L149 78 L155 65 L235 65"
            fill="none" stroke={moodColor} strokeWidth="1.8" strokeOpacity="0.7" strokeLinecap="round" strokeLinejoin="round" />

          {/* ── HELMET OUTER SHELL ── */}
          <ellipse cx="170" cy="158" rx="100" ry="98"
            fill={`url(#hg-${uid})`} filter={`url(#shadow-${uid})`} />
          {/* Helmet specular highlight */}
          <ellipse cx="140" cy="110" rx="34" ry="22" fill="rgba(255,255,255,0.3)" transform="rotate(-18 140 110)" />
          <ellipse cx="125" cy="125" rx="10" ry="6" fill="rgba(255,255,255,0.2)" transform="rotate(-10 125 125)" />
          {/* Helmet neon rim */}
          <ellipse cx="170" cy="158" rx="100" ry="98" fill="none" stroke={moodColor} strokeWidth="2.5" opacity="0.5" />
          {/* Helmet panel lines */}
          <path d="M80 150 Q82 118 170 108 Q258 118 260 150" fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="1" />

          {/* LiTTree LabStudios branding on helmet forehead */}
          {/* Flask icon */}
          <g transform="translate(147, 72)">
            <path d="M10 18 L10 10 L12 10 L12 6 L14 6 L14 10 L16 10 L16 18 Q13 21 10 18 Z"
              fill={moodColor} opacity="0.9" />
            <path d="M9 14 Q13 17 17 14" fill={moodColor} opacity="0.4" />
          </g>
          <text x="170" y="96" textAnchor="middle" fontSize="10" fontWeight="800" fill="#111" fontFamily="'Arial Black', Arial, sans-serif" letterSpacing="0.5">LiTTree</text>
          <text x="170" y="107" textAnchor="middle" fontSize="7.5" fontWeight="600" fill="#333" fontFamily="Arial, sans-serif">LabStudios</text>

          {/* ── VISOR ── */}
          <path d="M92 162 Q90 98 170 96 Q250 98 248 162 Q248 196 212 204 L128 204 Q92 196 92 162 Z"
            fill={`url(#visor-${uid})`} stroke="#1e1e2e" strokeWidth="2.5" />
          {/* Visor inner rim glow */}
          <path d="M95 162 Q93 102 170 100 Q247 102 245 162 Q245 193 210 201 L130 201 Q95 193 95 162 Z"
            fill="none" stroke={moodColor} strokeWidth="1" opacity="0.25" />
          {/* Visor reflections */}
          <path d="M112 122 Q150 107 210 116" stroke="rgba(255,255,255,0.12)" strokeWidth="5" strokeLinecap="round" fill="none" />
          <path d="M108 140 Q135 130 168 133" stroke="rgba(255,255,255,0.07)" strokeWidth="2.5" strokeLinecap="round" fill="none" />

          {/* ── EYES ── */}
          <g filter={`url(#glow-${uid})`}>
            <LiTTEye mood={mood} cx={140} cy={162} color={moodColor} />
            <LiTTEye mood={mood} cx={200} cy={162} color={moodColor} />
          </g>

          {/* ── MOUTH ── */}
          <path d={getMouthPath(mood)} stroke={moodColor} strokeWidth="3.5"
            strokeLinecap="round" fill="none" filter={`url(#glow-${uid})`} />

          {/* Love cheeks */}
          {isLove && (
            <>
              <ellipse cx="112" cy="182" rx="10" ry="7" fill="#ff6b8a" opacity="0.4" />
              <ellipse cx="228" cy="182" rx="10" ry="7" fill="#ff6b8a" opacity="0.4" />
            </>
          )}

          {/* ── HEADPHONE BAND + RIGHT BADGE ── */}
          {/* Band */}
          <path d="M170 58 Q265 54 265 148" fill="none" stroke="#2a2a38" strokeWidth="9" strokeLinecap="round" />
          <path d="M170 58 Q265 54 265 148" fill="none" stroke={moodColor} strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.4" />
          {/* Right badge */}
          <circle cx="265" cy="158" r="20" fill="#0d0d18" stroke={moodColor} strokeWidth="2.5" />
          <circle cx="265" cy="158" r="20" fill={moodColor} opacity="0.08" filter={`url(#glow-${uid})`} />
          <text x="265" y="163" textAnchor="middle" fontSize="9" fontWeight="900" fill={moodColor} fontFamily="'Arial Black', Arial, sans-serif">LiT</text>

          {/* ── NECK ── */}
          <rect x="148" y="216" width="44" height="24" rx="8" fill="#0d0d18" />
          <rect x="154" y="218" width="32" height="4" rx="2" fill={moodColor} opacity="0.3" />

          {/* ── BODY / HOODIE TORSO ── */}
          <path d="M88 235 Q72 242 65 268 L60 355 Q60 368 75 368 L265 368 Q280 368 280 355 L275 268 Q268 242 252 235 Z"
            fill={`url(#body-${uid})`} filter={`url(#shadow-${uid})`} />
          {/* Hoodie bottom neon trim */}
          <path d="M60 355 Q60 370 75 370 L265 370 Q280 370 280 355 L276 352 L64 352 Z"
            fill={moodColor} opacity="0.35" />
          {/* Hoodie zipper */}
          <line x1="170" y1="240" x2="170" y2="368" stroke={moodColor} strokeWidth="1.5" opacity="0.18" strokeDasharray="5 4" />
          {/* Left neon arm stripe */}
          <rect x="75" y="242" width="5" height="90" rx="2.5" fill={moodColor} opacity="0.55" />
          {/* Right neon arm stripe */}
          <rect x="260" y="242" width="5" height="90" rx="2.5" fill={moodColor} opacity="0.55" />
          {/* Circuit board pattern on body */}
          <path d="M105 260 L105 330 M105 280 L125 280 M125 280 L125 310 M125 310 L140 310"
            stroke={moodColor} strokeWidth="1.2" opacity="0.28" strokeLinecap="round" />
          <path d="M210 265 L210 320 M195 292 L210 292 M195 292 L195 315"
            stroke={moodColor} strokeWidth="1.2" opacity="0.22" strokeLinecap="round" />
          {/* Tree circuit on lower body */}
          <path d="M155 340 L155 368 M145 350 L165 350 M138 345 L152 355 M172 355 L182 345"
            stroke={moodColor} strokeWidth="1" opacity="0.2" strokeLinecap="round" />

          {/* ── CHEST BADGE ── */}
          <rect x="138" y="278" width="64" height="34" rx="10" fill={`url(#chest-${uid})`} stroke={moodColor} strokeWidth="2" />
          <rect x="138" y="278" width="64" height="34" rx="10" fill={moodColor} opacity="0.05" filter={`url(#glow-${uid})`} />
          <text x="170" y="291" textAnchor="middle" fontSize="8" fontWeight="700" fill={moodColor} fontFamily="Arial, sans-serif" opacity="0.7">LiTTree</text>
          <text x="170" y="304" textAnchor="middle" fontSize="14" fontWeight="900" fill={moodColor} fontFamily="'Arial Black', Arial, sans-serif">LiT</text>

          {/* ── FLASK LEFT SHOULDER BADGE ── */}
          <circle cx="72" cy="248" r="15" fill="#0d0d18" stroke={moodColor} strokeWidth="2" />
          <g transform="translate(63, 238)">
            <path d="M6 20 L6 12 L8 12 L8 8 L10 8 L10 12 L12 12 L12 20 Q9 23 6 20 Z"
              fill={moodColor} opacity="0.9" />
            <path d="M5 16 Q9 19 13 16" fill={moodColor} opacity="0.35" />
          </g>

          {/* ── LEFT ARM ── */}
          <path d="M88 240 Q52 248 40 285 Q33 308 42 328 Q50 344 68 342 L82 308 Q88 285 96 262 Z"
            fill="#18182a" stroke={moodColor} strokeWidth="1.2" strokeOpacity="0.25" />
          {/* Left glove */}
          <ellipse cx="44" cy="336" rx="16" ry="13" fill="#e8e8e8" />
          <ellipse cx="44" cy="336" rx="16" ry="13" fill={moodColor} opacity="0.18" filter={`url(#glow-${uid})`} />
          {/* Left hand pose — peace or thinking */}
          {isThinking ? (
            <>
              <rect x="35" y="320" width="7" height="16" rx="3.5" fill="#e8e8e8" />
              <rect x="44" y="316" width="7" height="20" rx="3.5" fill="#e8e8e8" />
            </>
          ) : isExcited ? (
            <>
              <rect x="33" y="318" width="7" height="18" rx="3.5" fill="#e8e8e8" />
              <rect x="42" y="315" width="7" height="21" rx="3.5" fill="#e8e8e8" />
              <rect x="51" y="318" width="6" height="18" rx="3" fill="#e8e8e8" />
            </>
          ) : (
            <>
              <rect x="33" y="320" width="7" height="16" rx="3.5" fill="#e8e8e8" />
              <rect x="42" y="317" width="7" height="19" rx="3.5" fill="#e8e8e8" />
              <rect x="51" y="320" width="6" height="16" rx="3" fill="#e8e8e8" />
            </>
          )}
          {/* Left arm neon cuff */}
          <path d="M64 340 Q68 346 80 344" fill="none" stroke={moodColor} strokeWidth="2.5" opacity="0.6" strokeLinecap="round" />

          {/* ── RIGHT ARM ── */}
          <path d="M252 240 Q288 248 300 285 Q307 308 298 328 Q290 344 272 342 L258 308 Q252 285 244 262 Z"
            fill="#18182a" stroke={moodColor} strokeWidth="1.2" strokeOpacity="0.25" />
          {/* Right glove */}
          <ellipse cx="296" cy="336" rx="16" ry="13" fill="#e8e8e8" />
          <ellipse cx="296" cy="336" rx="16" ry="13" fill={moodColor} opacity="0.18" filter={`url(#glow-${uid})`} />
          <rect x="287" y="320" width="7" height="16" rx="3.5" fill="#e8e8e8" />
          <rect x="296" y="322" width="7" height="14" rx="3.5" fill="#e8e8e8" />
          {/* Right arm neon cuff */}
          <path d="M276 340 Q280 346 292 344" fill="none" stroke={moodColor} strokeWidth="2.5" opacity="0.6" strokeLinecap="round" />

          {/* ── LEGS ── */}
          <path d="M112 366 L100 404 Q97 412 112 412 L152 412 Q160 412 157 405 L154 366 Z" fill="#111120" />
          <path d="M228 366 L240 404 Q243 412 228 412 L188 412 Q180 412 183 405 L186 366 Z" fill="#111120" />
          {/* Leg neon seam */}
          <line x1="132" y1="366" x2="126" y2="412" stroke={moodColor} strokeWidth="1" opacity="0.2" />
          <line x1="208" y1="366" x2="214" y2="412" stroke={moodColor} strokeWidth="1" opacity="0.2" />

          {/* ── SNEAKERS ── */}
          {/* Left */}
          <path d="M90 404 Q88 420 104 422 L158 420 Q168 418 164 408 L152 404 Z"
            fill={`url(#shoe-${uid})`} />
          <path d="M90 404 Q88 420 104 422 L158 420 Q168 418 164 408 L152 404 Z"
            fill={moodColor} opacity="0.12" />
          <rect x="90" y="404" width="74" height="8" rx="4" fill={moodColor} opacity="0.2" />
          <text x="127" y="416" textAnchor="middle" fontSize="6" fill="#222" fontFamily="Arial, sans-serif" fontWeight="800">LiTTree</text>
          <ellipse cx="127" cy="420" rx="32" ry="5" fill={moodColor} opacity="0.3" filter={`url(#glow-${uid})`} />
          {/* Right */}
          <path d="M250 404 Q252 420 236 422 L182 420 Q172 418 176 408 L188 404 Z"
            fill={`url(#shoe-${uid})`} />
          <path d="M250 404 Q252 420 236 422 L182 420 Q172 418 176 408 L188 404 Z"
            fill={moodColor} opacity="0.12" />
          <rect x="176" y="404" width="74" height="8" rx="4" fill={moodColor} opacity="0.2" />
          <text x="213" y="416" textAnchor="middle" fontSize="6" fill="#222" fontFamily="Arial, sans-serif" fontWeight="800">LiTTree</text>
          <ellipse cx="213" cy="420" rx="32" ry="5" fill={moodColor} opacity="0.3" filter={`url(#glow-${uid})`} />

          {/* Thinking bubbles */}
          {isThinking && (
            <>
              <circle cx="272" cy="95" r="5" fill={moodColor} opacity="0.9" filter={`url(#glow-${uid})`} />
              <circle cx="290" cy="78" r="8" fill={moodColor} opacity="0.7" filter={`url(#glow-${uid})`} />
              <circle cx="312" cy="60" r="11" fill={moodColor} opacity="0.5" filter={`url(#glow-${uid})`} />
            </>
          )}

          {/* Excited sparkles */}
          {isExcited && (
            <>
              <path d="M42 80 L46 70 L50 80 L42 80 Z" fill={moodColor} opacity="0.8" filter={`url(#glow-${uid})`} />
              <path d="M46 64 L47 74" stroke={moodColor} strokeWidth="2" strokeLinecap="round" opacity="0.7" />
              <path d="M38 72 L56 72" stroke={moodColor} strokeWidth="2" strokeLinecap="round" opacity="0.7" />
              <path d="M295 82 L299 72 L303 82 L295 82 Z" fill={moodColor} opacity="0.7" filter={`url(#glow-${uid})`} />
            </>
          )}
        </svg>
      </div>

      <style>{`
        @keyframes litt-breathe {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-5px); }
        }
        @keyframes litt-bounce {
          0% { transform: translateY(0px) rotate(-3deg); }
          100% { transform: translateY(-10px) rotate(3deg); }
        }
        @keyframes litt-sway {
          0%, 100% { transform: rotate(-1deg); }
          50% { transform: rotate(1deg); }
        }
      `}</style>

      {showBadge && <LiTTMoodBadge mood={mood} />}
    </div>
  );
}

function LiTTEye({
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
  if (mood === "wink" && cx > 170) {
    return <path d={`M${cx - 14} ${cy} Q${cx} ${cy - 8} ${cx + 14} ${cy}`} stroke={color} strokeWidth="3.5" strokeLinecap="round" fill="none" />;
  }
  if (mood === "sleepy") {
    return (
      <>
        <path d={`M${cx - 14} ${cy} Q${cx} ${cy + 6} ${cx + 14} ${cy}`} stroke={color} strokeWidth="3.5" strokeLinecap="round" fill="none" />
        <path d={`M${cx - 14} ${cy} Q${cx} ${cy - 4} ${cx + 14} ${cy}`} stroke={color} strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.35" />
      </>
    );
  }
  if (mood === "surprised") {
    return (
      <>
        <circle cx={cx} cy={cy} r="11" fill={color} opacity="0.2" />
        <circle cx={cx} cy={cy} r="7" fill={color} />
      </>
    );
  }
  if (mood === "thinking") {
    return <circle cx={cx} cy={cy} r="8" fill={color} opacity="0.9" />;
  }
  if (mood === "love") {
    return (
      <path d={`M${cx - 12} ${cy + 2} Q${cx - 12} ${cy - 10} ${cx} ${cy - 4} Q${cx + 12} ${cy - 10} ${cx + 12} ${cy + 2} Q${cx} ${cy + 14} ${cx - 12} ${cy + 2}`}
        fill={color} opacity="0.9" />
    );
  }
  return (
    <path d={`M${cx - 14} ${cy} Q${cx} ${cy - 14} ${cx + 14} ${cy}`}
      stroke={color} strokeWidth="4.5" strokeLinecap="round" fill="none" />
  );
}

function getMouthPath(mood: LiTTMood): string {
  switch (mood) {
    case "happy":
    case "excited":
      return "M133 183 Q170 202 207 183";
    case "love":
      return "M138 180 Q170 198 202 180";
    case "focused":
      return "M150 186 Q170 188 190 186";
    case "thinking":
      return "M148 185 Q162 182 176 188";
    case "wink":
    case "cheeky":
      return "M138 183 Q165 196 202 180";
    case "surprised":
      return "M155 175 Q170 162 185 175 Q170 192 155 175";
    case "sleepy":
      return "M145 186 Q170 180 195 186";
    default:
      return "M133 183 Q170 202 207 183";
  }
}
