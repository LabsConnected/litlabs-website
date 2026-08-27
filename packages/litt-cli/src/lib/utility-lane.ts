/**
 * UTILITY lane — trivial factual lookups answered without the model.
 *
 * Sits alongside the other submit lanes:
 *   LOCAL   → deterministic local state (no model, no tools)
 *   UTILITY → one bounded realtime tool (or pure arithmetic) → literal answer
 *   READ    → bounded read-only project tools → optional one synthesis call
 *   CHAT    → conversation (model only, no tools)
 *   MISSION → full mission lifecycle (planner, agent loop, verification)
 *
 * Why it exists: "what's the weather in 49456" and "what's 18% of 240"
 * do not need a planner, an agent loop, or even a model round trip. They
 * need one cheap call to a known-good source (NWS / DuckDuckGo) or a bit
 * of arithmetic. Routing them through the model costs seconds and dollars
 * and invites invention — a model answering weather from memory is a
 * model making things up.
 *
 * Scope discipline — this lane is deliberately hard to trigger:
 *   - The controller only consults it for "chat"-classified, non-mission
 *     input. Coding, inspection, build and deploy work never reaches it.
 *   - Classification requires an explicit utility signal. A bare ZIP, a
 *     version number, or a sentence that merely contains "open" does not
 *     match.
 *   - When the lane cannot actually answer (no ZIP for a US-only weather
 *     API, an expression that will not parse, an empty search) it reports
 *     `satisfied: false` and renders NOTHING. The controller then falls
 *     through to the normal chat path exactly as if no match existed.
 *
 * Honesty rules:
 *   - Every non-arithmetic answer is backed by a real tool result. The
 *     lane never invents a fact and never paraphrases a failed lookup
 *     into a confident answer.
 *   - A failed or empty tool result is never dressed up as an answer —
 *     it becomes `satisfied: false` and the model gets the turn.
 *   - `toolsUsed` reports what actually ran, so the operator feed and
 *     perf trace stay truthful.
 *
 * Tools used (all read-only, no credentials, registered by @litt/agent-core):
 *   weather.forecast — National Weather Service, 5-digit US ZIP
 *   web.search       — DuckDuckGo Instant Answers
 */

import type { ToolResult } from "@litt/agent-core";

// ─── Types ─────────────────────────────────────────────────────────

export type UtilityKind =
  | "weather"
  | "time"
  | "calculator"
  | "business-hours"
  | "local-place";

/** Weather — answered by weather.forecast (US ZIP only). */
export interface WeatherUtilityMatch {
  kind: "weather";
  /** 5-digit US ZIP found in the query, or null (→ cannot be satisfied). */
  zip: string | null;
}

/** Current time — answered locally from the system clock. */
export interface TimeUtilityMatch {
  kind: "time";
  /** IANA zone requested, or null for the local zone. */
  timeZone: string | null;
  /** The place the user named, for the answer text. */
  place: string | null;
}

/** Arithmetic — answered locally by a bounded expression parser. */
export interface CalculatorUtilityMatch {
  kind: "calculator";
  /** The normalized expression source. */
  expression: string;
}

/** Opening hours of a named place — answered by web.search. */
export interface BusinessHoursUtilityMatch {
  kind: "business-hours";
  subject: string;
}

/** "nearest X" / "X near me" — answered by web.search. */
export interface LocalPlaceUtilityMatch {
  kind: "local-place";
  subject: string;
}

export type UtilityMatch =
  | WeatherUtilityMatch
  | TimeUtilityMatch
  | CalculatorUtilityMatch
  | BusinessHoursUtilityMatch
  | LocalPlaceUtilityMatch;

/**
 * Executes one canonical tool. The controller supplies this, routing
 * through the session's ExecutionGateway — this module never touches the
 * network or the registry directly, so gateway policy, approval, and
 * audit still apply to every call the lane makes.
 */
export type UtilityToolRunner = (
  toolId: string,
  args: Record<string, unknown>,
) => Promise<ToolResult>;

export interface UtilityLookupResult {
  /**
   * True only when the lane produced a real answer. False means the
   * caller must fall through to the normal path — `text` is then empty
   * and MUST NOT be rendered.
   */
  satisfied: boolean;
  /** The answer, ready to render verbatim. Empty when not satisfied. */
  text: string;
  /** Tool ids that actually executed. Empty for purely local answers. */
  toolsUsed: string[];
  /** Why the lane declined. Present only when satisfied is false. */
  reason?: string;
}

const UNSATISFIED = (reason: string, toolsUsed: string[] = []): UtilityLookupResult => ({
  satisfied: false,
  text: "",
  toolsUsed,
  reason,
});

// ─── Classification ────────────────────────────────────────────────

const WEATHER_SIGNAL =
  /\b(weather|forecast|temperature|how (?:hot|cold|warm) is it|is it (?:raining|snowing|sunny)|rain(?:ing)?|snow(?:ing)?)\b/i;
const ZIP = /\b(\d{5})\b/;

const TIME_SIGNAL =
  /\b(?:what(?:'s| is)? the (?:current )?time|what time is it|current time|time right now)\b/i;
const TIME_IN = /\btime\b[^.?!]*\bin\s+([a-z][a-z .'\-/]{1,40})/i;

const BUSINESS_HOURS_PATTERNS: RegExp[] = [
  /\bwhat time does\s+(.+?)\s+(?:open|close)\b/i,
  /\bwhen does\s+(.+?)\s+(?:open|close)\b/i,
  /\bis\s+(.+?)\s+open\s+(?:now|today|right now)\b/i,
  /\b(?:opening|business|store)\s+hours\s+(?:of|for|at)\s+(.+)$/i,
  /\bwhat are\s+(.+?)(?:'s)?\s+hours\b/i,
  /\bhours\s+(?:of|for)\s+(.+)$/i,
];

const LOCAL_PLACE_PATTERNS: RegExp[] = [
  /\b(?:nearest|closest)\s+(.+)$/i,
  /\b(.+?)\s+near\s+(?:me|here)\b/i,
  /\b(.+?)\s+nearby\b/i,
];

/** Chars a bare arithmetic expression may contain. */
const ARITHMETIC_SHAPE = /^[\d\s.+\-*/%^()]+$/;
/** An expression must actually compute something, not just be a number. */
const HAS_OPERATOR = /[+\-*/%^]/;

const CALC_PREFIX =
  /^(?:what(?:'s| is)|whats|calculate|compute|solve|eval(?:uate)?|how much is)\b[\s:]*/i;
const PERCENT_OF = /^(?:what(?:'s| is)|whats|how much is)?\s*([\d.]+)\s*%\s+of\s+([\d.]+)\s*\??$/i;

/** Strip conversational punctuation/filler that never changes the answer. */
function normalize(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

/**
 * Classify a chat-intent query as a utility lookup, or return null.
 *
 * Returning a match is NOT a promise that the lane can answer — see
 * executeUtilityLookup, which is where "matched but cannot be satisfied"
 * (no ZIP, unparseable expression, empty search) is decided.
 */
export function classifyUtilityIntent(input: string): UtilityMatch | null {
  const text = normalize(input);
  if (!text || text.startsWith("/")) return null;
  // Long prose is a conversation, not a lookup.
  if (text.length > 200) return null;

  // ─── Calculator ───
  // The WHOLE query must be arithmetic (after an optional "what is"
  // prefix), so "rewrite 2 + 2 in Python" never matches.
  const percent = text.match(PERCENT_OF);
  if (percent) {
    return { kind: "calculator", expression: `${percent[1]} / 100 * ${percent[2]}` };
  }
  const calcBody = text.replace(CALC_PREFIX, "").replace(/[?=]+\s*$/, "").trim();
  if (calcBody && ARITHMETIC_SHAPE.test(calcBody) && HAS_OPERATOR.test(calcBody)) {
    return { kind: "calculator", expression: calcBody };
  }

  // ─── Weather ───
  if (WEATHER_SIGNAL.test(text)) {
    const zip = text.match(ZIP);
    return { kind: "weather", zip: zip ? zip[1] : null };
  }

  // ─── Time ───
  if (TIME_SIGNAL.test(text) || /\bwhat time is it in\b/i.test(text)) {
    const inMatch = text.match(TIME_IN);
    if (inMatch) {
      const place = inMatch[1].trim().replace(/[?.!]+$/, "");
      return { kind: "time", timeZone: resolveTimeZone(place), place };
    }
    return { kind: "time", timeZone: null, place: null };
  }

  // ─── Business hours ───
  for (const pattern of BUSINESS_HOURS_PATTERNS) {
    const m = text.match(pattern);
    if (m) {
      const subject = cleanSubject(m[1]);
      if (subject) return { kind: "business-hours", subject };
    }
  }

  // ─── Local place ───
  for (const pattern of LOCAL_PLACE_PATTERNS) {
    const m = text.match(pattern);
    if (m) {
      const subject = cleanSubject(m[1]);
      if (subject) return { kind: "local-place", subject };
    }
  }

  return null;
}

/** Trim filler off an extracted subject; return "" when nothing useful is left. */
function cleanSubject(raw: string | undefined): string {
  if (!raw) return "";
  const cleaned = raw
    .trim()
    .replace(/^(?:the|a|an|my)\s+/i, "")
    .replace(/[?.!,]+$/, "")
    .trim();
  if (cleaned.length < 2 || cleaned.length > 80) return "";
  return cleaned;
}

// ─── Time zones ────────────────────────────────────────────────────

/**
 * Common city/region → IANA zone. Deliberately small: an unrecognized
 * place returns null, which makes the lookup unsatisfied and hands the
 * turn to the model rather than guessing a zone.
 */
const TIME_ZONES: Record<string, string> = {
  "utc": "UTC",
  "gmt": "UTC",
  "new york": "America/New_York",
  "nyc": "America/New_York",
  "boston": "America/New_York",
  "miami": "America/New_York",
  "toronto": "America/Toronto",
  "chicago": "America/Chicago",
  "dallas": "America/Chicago",
  "houston": "America/Chicago",
  "denver": "America/Denver",
  "phoenix": "America/Phoenix",
  "los angeles": "America/Los_Angeles",
  "la": "America/Los_Angeles",
  "san francisco": "America/Los_Angeles",
  "seattle": "America/Los_Angeles",
  "vancouver": "America/Vancouver",
  "mexico city": "America/Mexico_City",
  "sao paulo": "America/Sao_Paulo",
  "london": "Europe/London",
  "dublin": "Europe/Dublin",
  "lisbon": "Europe/Lisbon",
  "madrid": "Europe/Madrid",
  "paris": "Europe/Paris",
  "amsterdam": "Europe/Amsterdam",
  "brussels": "Europe/Brussels",
  "berlin": "Europe/Berlin",
  "zurich": "Europe/Zurich",
  "rome": "Europe/Rome",
  "stockholm": "Europe/Stockholm",
  "warsaw": "Europe/Warsaw",
  "athens": "Europe/Athens",
  "istanbul": "Europe/Istanbul",
  "moscow": "Europe/Moscow",
  "dubai": "Asia/Dubai",
  "mumbai": "Asia/Kolkata",
  "delhi": "Asia/Kolkata",
  "bangalore": "Asia/Kolkata",
  "india": "Asia/Kolkata",
  "singapore": "Asia/Singapore",
  "hong kong": "Asia/Hong_Kong",
  "beijing": "Asia/Shanghai",
  "shanghai": "Asia/Shanghai",
  "seoul": "Asia/Seoul",
  "tokyo": "Asia/Tokyo",
  "japan": "Asia/Tokyo",
  "sydney": "Australia/Sydney",
  "melbourne": "Australia/Melbourne",
  "auckland": "Pacific/Auckland",
};

/** Resolve a place to an IANA zone, or null when it is not recognized. */
export function resolveTimeZone(place: string): string | null {
  const key = place.trim().toLowerCase().replace(/[?.!,]+$/, "");
  if (!key) return null;
  const mapped = TIME_ZONES[key];
  if (mapped) return mapped;
  // An explicit IANA zone ("America/New_York") — accept it if the
  // runtime actually knows it.
  if (key.includes("/") && isValidTimeZone(place.trim())) return place.trim();
  return null;
}

function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// ─── Arithmetic ────────────────────────────────────────────────────

/**
 * Evaluate a bounded arithmetic expression.
 *
 * A hand-written recursive-descent parser — NOT eval/Function. The lane
 * runs on user input, so there is no code path here that can execute
 * anything the user typed. Returns null when the expression does not
 * parse or is not finite (which becomes an unsatisfied lookup).
 *
 * Supports: + - * / % ^, unary minus, parentheses, decimals.
 */
export function evaluateExpression(source: string): number | null {
  const tokens = source.match(/\d+\.?\d*|\.\d+|[+\-*/%^()]/g);
  if (!tokens) return null;
  // Reject anything the tokenizer had to skip — no silent reinterpretation.
  if (tokens.join("").length !== source.replace(/\s+/g, "").length) return null;

  let pos = 0;
  const peek = (): string | undefined => tokens[pos];
  const eat = (): string => tokens[pos++];

  // expr := term (('+' | '-') term)*
  function parseExpr(): number | null {
    let left = parseTerm();
    if (left === null) return null;
    while (peek() === "+" || peek() === "-") {
      const op = eat();
      const right = parseTerm();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  // term := factor (('*' | '/' | '%') factor)*
  function parseTerm(): number | null {
    let left = parseFactor();
    if (left === null) return null;
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = eat();
      const right = parseFactor();
      if (right === null) return null;
      if ((op === "/" || op === "%") && right === 0) return null; // no Infinity/NaN answers
      left = op === "*" ? left * right : op === "/" ? left / right : left % right;
    }
    return left;
  }

  // factor := unary ('^' factor)?   — right associative
  function parseFactor(): number | null {
    const base = parseUnary();
    if (base === null) return null;
    if (peek() === "^") {
      eat();
      const exp = parseFactor();
      if (exp === null) return null;
      return Math.pow(base, exp);
    }
    return base;
  }

  // unary := ('-' | '+') unary | primary
  function parseUnary(): number | null {
    if (peek() === "-") { eat(); const v = parseUnary(); return v === null ? null : -v; }
    if (peek() === "+") { eat(); return parseUnary(); }
    return parsePrimary();
  }

  // primary := number | '(' expr ')'
  function parsePrimary(): number | null {
    const token = peek();
    if (token === undefined) return null;
    if (token === "(") {
      eat();
      const value = parseExpr();
      if (value === null || peek() !== ")") return null;
      eat();
      return value;
    }
    if (/^[\d.]/.test(token)) {
      eat();
      const n = Number(token);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  const result = parseExpr();
  if (result === null || pos !== tokens.length) return null;
  return Number.isFinite(result) ? result : null;
}

/** Render a computed number without floating-point noise. */
function formatNumber(n: number): string {
  const rounded = Math.round(n * 1e10) / 1e10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

// ─── Execution ─────────────────────────────────────────────────────

/**
 * Answer a classified utility query.
 *
 * `satisfied: false` is a normal, expected outcome — it means the lane
 * declined and the caller must fall through to the model. The wasted
 * attempt is at most one cheap NWS/DuckDuckGo call, never an LLM round
 * trip. Nothing is rendered for an unsatisfied result.
 */
export async function executeUtilityLookup(
  match: UtilityMatch,
  runTool: UtilityToolRunner,
): Promise<UtilityLookupResult> {
  switch (match.kind) {
    case "calculator":
      return executeCalculator(match);
    case "time":
      return executeTime(match);
    case "weather":
      return executeWeather(match, runTool);
    case "business-hours":
      return executeSearch(`${match.subject} opening hours`, runTool);
    case "local-place":
      return executeSearch(`${match.subject} near me`, runTool);
  }
}

function executeCalculator(match: CalculatorUtilityMatch): UtilityLookupResult {
  const value = evaluateExpression(match.expression);
  if (value === null) return UNSATISFIED("expression did not parse");
  return { satisfied: true, text: formatNumber(value), toolsUsed: [] };
}

function executeTime(match: TimeUtilityMatch): UtilityLookupResult {
  // "time in <somewhere we don't know>" must not be guessed.
  if (match.place && !match.timeZone) {
    return UNSATISFIED(`unrecognized time zone for "${match.place}"`);
  }
  const zone = match.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  let formatted: string;
  try {
    formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date());
  } catch {
    return UNSATISFIED(`invalid time zone "${zone}"`);
  }
  const where = match.place ? `${match.place} (${zone})` : zone;
  return { satisfied: true, text: `${formatted} — ${where}`, toolsUsed: [] };
}

async function executeWeather(
  match: WeatherUtilityMatch,
  runTool: UtilityToolRunner,
): Promise<UtilityLookupResult> {
  // The forecast source is US-ZIP-only. Without a ZIP the lane cannot
  // answer — it hands the turn to the model, which can ask for one.
  if (!match.zip) return UNSATISFIED("no US ZIP code in the query");

  const result = await runTool("weather.forecast", { zip: match.zip });
  const toolsUsed = ["weather.forecast"];
  if (!result.success) return UNSATISFIED(result.message || "forecast lookup failed", toolsUsed);

  const location = result.data.location as
    | { place?: string; state?: string; zip?: string }
    | undefined;
  const periods = result.data.periods as
    | Array<{
        name?: string;
        temperature?: number | null;
        temperatureUnit?: string | null;
        shortForecast?: string | null;
        windSpeed?: string | null;
        probabilityOfPrecipitation?: number | null;
      }>
    | undefined;
  if (!Array.isArray(periods) || periods.length === 0) {
    return UNSATISFIED("forecast returned no periods", toolsUsed);
  }

  const where = location?.place
    ? `${location.place}${location.state ? `, ${location.state}` : ""} (${match.zip})`
    : match.zip;
  const lines = [`Weather for ${where}:`];
  for (const period of periods.slice(0, 2)) {
    const parts: string[] = [];
    if (period.temperature !== null && period.temperature !== undefined) {
      parts.push(`${period.temperature}°${period.temperatureUnit ?? "F"}`);
    }
    if (period.shortForecast) parts.push(period.shortForecast);
    if (period.windSpeed) parts.push(`wind ${period.windSpeed}`);
    if (
      period.probabilityOfPrecipitation !== null
      && period.probabilityOfPrecipitation !== undefined
      && period.probabilityOfPrecipitation > 0
    ) {
      parts.push(`${period.probabilityOfPrecipitation}% precip`);
    }
    if (parts.length === 0) continue;
    lines.push(`  ${period.name ?? "Now"}: ${parts.join(" · ")}`);
  }
  // Only the header survived — nothing real to report.
  if (lines.length === 1) return UNSATISFIED("forecast periods had no usable data", toolsUsed);
  lines.push("Source: National Weather Service");
  return { satisfied: true, text: lines.join("\n"), toolsUsed };
}

async function executeSearch(
  query: string,
  runTool: UtilityToolRunner,
): Promise<UtilityLookupResult> {
  const result = await runTool("web.search", { query });
  const toolsUsed = ["web.search"];
  if (!result.success) return UNSATISFIED(result.message || "search failed", toolsUsed);
  if (result.data.empty === true) return UNSATISFIED("search returned no instant answer", toolsUsed);

  const answer = typeof result.data.answer === "string" ? result.data.answer : null;
  const abstract = typeof result.data.abstract === "string" ? result.data.abstract : null;
  const body = answer || abstract;
  if (!body) return UNSATISFIED("search returned no instant answer", toolsUsed);

  const source = typeof result.data.abstractSource === "string" ? result.data.abstractSource : null;
  const url = typeof result.data.abstractUrl === "string" ? result.data.abstractUrl : null;
  const attribution = source ? `Source: ${source}${url ? ` — ${url}` : ""}` : null;
  return {
    satisfied: true,
    text: attribution ? `${body}\n${attribution}` : body,
    toolsUsed,
  };
}
