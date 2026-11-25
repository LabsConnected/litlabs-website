/**
 * LiTT Agent Browser — navigate-time URL policy (Phase 2, §5.3 of the
 * agent-browser plan).
 *
 * Pure, dependency-free: safe to import from both server tool handlers
 * and (via re-export) the chat-facing orchestration layer, and trivially
 * unit-testable.
 *
 * The policy is LiTT's own guardrail, independent of the vendor's network
 * isolation. It blocks:
 *   - non-http(s) schemes: file://, chrome://, javascript:, data:, …
 *   - localhost / loopback (127.0.0.0/8, ::1, 0.0.0.0)
 *   - link-local ranges (169.254.0.0/16, fe80::/10) — these cover the
 *     cloud metadata endpoints (169.254.169.254, 100.100.100.200, …)
 *   - well-known cloud metadata hostnames
 *   - credential-phishing hostnames: verified legitimate domains are
 *     exempt (label-boundary match), everything else is checked for
 *     brand typosquats / impersonation, credential-bait phrasing, and
 *     the IDN homograph (punycode) prefix
 *
 * Known limitation (documented, not silent): this layer inspects the
 * literal hostname only. The Studio browser proxy route additionally
 * resolves every hostname and validates/pins each resolved address
 * (see src/lib/studio/proxy-destination.ts); other consumers (the
 * Stagehand-driven agent browser) rely on the remote browser's own
 * egress isolation for the DNS layer. The blocklist is a first line,
 * not a guarantee.
 */

import { ipBlockReason } from "./ip-address-safety";

export interface BrowserUrlPolicyResult {
  allowed: boolean;
  /** Present when blocked: human/agent-readable reason. */
  reason?: string;
  /** The host that was inspected (lowercased). */
  host?: string;
}

// ─── URL normalization ───────────────────────────────────────────
// (Moved here from browser-agent.ts Phase 1 so the navigate tool path can
// share it without creating an import cycle. browser-agent.ts re-exports
// it to keep the existing import path working.)

/**
 * Normalize user-supplied URL text for the browser.
 * Adds https:// when no scheme is present; rejects non-http(s) schemes
 * (file://, chrome://, javascript:, …) and unparseable input.
 * Returns null when the input is not a loadable web URL.
 */
export function normalizeBrowserUrl(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  // If the input already carries a scheme, only http(s) is loadable —
  // never rewrite file://, chrome://, javascript:, … into https://.
  const schemeMatch = trimmed.match(/^([a-z][a-z0-9+.-]*):/i);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https") return null;
    try {
      return new URL(trimmed).toString();
    } catch {
      return null;
    }
  }
  try {
    return new URL(`https://${trimmed}`).toString();
  } catch {
    return null;
  }
}

// ─── Policy ──────────────────────────────────────────────────────

// Cloud metadata hostnames (the metadata IPs are covered by the
// ip-address-safety classifier below).
const METADATA_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.google",
  "metadata.goog",
  "instance-data",
  "instance-data-compute",
]);

// ─── Credential-phishing hostname analysis ─────────────────────
//
// Brand impersonation is decided in two steps, because a substring
// regex cannot tell "google.com" from "g00gle.com" — the old
// /g[o0]{2}gle/ pattern matched BOTH spellings and blocked google.com
// in the Studio browser (false positive, 2026-11-25):
//
//   1. TRUSTED_DOMAINS — verified legitimate domains, matched on a
//      DNS label boundary (host === domain, or host ends with
//      "." + domain). "docs.google.com" is trusted; "google.com"
//      inside "google.com.evil.com" is NOT — that host merely
//      contains a trusted name and is handled by the impersonation
//      check below.
//   2. Every other host is split into per-label word tokens
//      (leetspeak-normalized) and compared against PROTECTED_BRANDS:
//        - leet/near-miss of a brand            → typosquat, blocked
//        - verbatim brand token + bait wording  → impersonation, blocked
//        - verbatim brand token alone           → allowed (real brands
//          run domains we cannot enumerate, e.g. microsoft.dev,
//          github.community; the registrable domain is what the user
//          actually sees)
//   On top of that: a trusted domain appearing as a non-final
//   subdomain ("google.com.evil.com") or a restricted public TLD
//   (.gov/.mil/.edu) appearing mid-host is deceptive and blocked.
//
// This is a first line, not a guarantee — DNS resolution is still
// out of scope at this layer (see the header comment).

/** Verified legitimate domains. Subdomains match on a label boundary. */
const TRUSTED_DOMAINS = new Set([
  // Google / YouTube
  "google.com", "google.co.uk", "google.ca", "google.com.au", "google.de",
  "google.fr", "google.co.jp", "google.co.in", "google.com.br", "google.it",
  "google.es", "google.nl", "google.se", "google.no", "google.dk", "google.fi",
  "google.pl", "google.ch", "google.at", "google.be", "google.ie", "google.co.nz",
  "google.com.sg", "google.com.mx", "google.com.tr", "google.com.ar", "google.cl",
  "google.com.co", "google.com.ph", "google.co.id", "google.com.my", "google.com.vn",
  "google.co.th", "google.com.hk", "google.com.tw", "google.ae", "google.sa",
  "google.co.za", "google.com.eg", "google.com.pk", "google.com.ng", "google.com.ua",
  "youtube.com", "youtu.be", "youtube-nocookie.com", "googlevideo.com",
  "ggpht.com", "blogspot.com", "googleapis.com", "gstatic.com",
  "googleusercontent.com", "gmail.com", "android.com", "chromium.org",
  "web.dev", "developer.android.com",
  // GitHub / Microsoft / OpenAI / Wikipedia
  "github.com", "github.io", "github.dev", "github.blog", "github.community",
  "githubusercontent.com", "githubassets.com",
  "microsoft.com", "microsoftonline.com", "microsoft.us", "microsoft.co.uk",
  "microsoft.ca", "microsoft.com.au", "microsoft.de", "microsoft.fr",
  "microsoft.co.jp", "microsoft.in", "microsoft.com.br", "live.com",
  "outlook.com", "office.com", "office.net", "office365.com", "msn.com",
  "windows.com", "bing.com", "azure.com", "azurewebsites.net", "azureedge.net",
  "visualstudio.com", "vscode.dev", "xbox.com", "skype.com",
  "openai.com", "chatgpt.com", "oaistatic.com", "oaiusercontent.com",
  "anthropic.com", "claude.ai",
  "wikipedia.org", "wikimedia.org", "wiktionary.org", "wikiquote.org",
  "wikibooks.org", "wikisource.org", "wikiversity.org", "wikinews.org",
  "wikivoyage.org", "mediawiki.org", "wikia.org", "fandom.com",
  // Other high-value brands
  "apple.com", "icloud.com", "me.com", "mac.com",
  "amazon.com", "amazon.co.uk", "amazon.de", "amazon.fr", "amazon.ca",
  "amazon.com.au", "amazon.co.jp", "amazon.in", "amazon.com.br", "amazon.es",
  "amazon.it", "amazon.nl", "amazon.se", "amazon.pl", "amazon.com.mx",
  "amazonaws.com", "aws.amazon.com", "imdb.com", "goodreads.com", "twitch.tv",
  "netflix.com", "nflxvideo.net", "hulu.com", "disneyplus.com", "hbomax.com",
  "spotify.com", "pandora.com", "soundcloud.com",
  "facebook.com", "fb.com", "fb.me", "instagram.com", "whatsapp.com",
  "messenger.com", "meta.com", "threads.net", "oculus.com",
  "paypal.com", "venmo.com", "stripe.com", "squareup.com", "cash.app",
  "wise.com", "revolut.com", "coinbase.com", "chime.com", "monzo.com",
  "twitter.com", "x.com", "linkedin.com", "reddit.com", "pinterest.com",
  "tumblr.com", "snapchat.com", "tiktok.com", "discord.com", "discordapp.com",
  "discord.gg", "telegram.org", "signal.org", "slack.com",
  "dropbox.com", "box.com", "adobe.com", "vercel.com", "netlify.com",
  "cloudflare.com", "digitalocean.com", "heroku.com", "shopify.com",
  "myshopify.com", "ebay.com", "etsy.com", "walmart.com", "target.com",
  "costco.com", "homedepot.com", "lowes.com", "ikea.com", "nike.com",
  "adidas.com", "lego.com", "samsung.com", "sony.com", "lg.com",
  "panasonic.com", "philips.com", "bosch.com", "siemens.com", "toyota.com",
  "honda.com", "ford.com", "tesla.com", "bmw.com", "mercedes-benz.com",
  "audi.com", "volkswagen.com", "dell.com", "hp.com", "lenovo.com",
  "asus.com", "acer.com", "intel.com", "amd.com", "nvidia.com", "qualcomm.com",
  "zoom.us", "webex.com", "docusign.com", "atlassian.com", "jetbrains.com",
  "docker.com", "stackoverflow.com", "stackexchange.com", "npmjs.com",
  "pypi.org", "crates.io", "rubygems.org", "apache.org", "eclipse.org",
  "kernel.org", "ubuntu.com", "debian.org", "redhat.com", "fedoraproject.org",
  "archlinux.org", "nixos.org", "npmjs.org",
  "chase.com", "wellsfargo.com", "citibank.com", "capitalone.com",
  "hsbc.com", "barclays.com", "bankofamerica.com", "usbank.com", "pnc.com",
  "td.com", "schwab.com", "fidelity.com", "discover.com",
  "americanexpress.com", "visa.com", "mastercard.com", "ally.com",
  "n26.com", "ing.com", "revolut.com", "wise.com",
  "imdb.com", "rottentomatoes.com", "letterboxd.com", "medium.com",
  "substack.com", "patreon.com", "kickstarter.com", "indiegogo.com",
  "gofundme.com", "eventbrite.com", "meetup.com", "airbnb.com", "uber.com",
  "lyft.com", "doordash.com", "grubhub.com", "instacart.com", "booking.com",
  "expedia.com", "kayak.com", "tripadvisor.com", "vrbo.com", "skyscanner.com",
  "hotels.com", "steam.com", "steampowered.com", "epicgames.com",
  "riotgames.com", "blizzard.com", "ea.com", "ubisoft.com", "roblox.com",
  "minecraft.net", "playstation.com", "xbox.com", "nintendo.com",
  "nordvpn.com", "expressvpn.com", "surfshark.com", "protonvpn.com",
  "proton.me", "protonmail.com", "lastpass.com", "1password.com",
  "bitwarden.com", "keepersecurity.com", "norton.com", "mcafee.com",
  "avast.com", "malwarebytes.com", "eset.com", "bitdefender.com",
  "trendmicro.com", "crowdstrike.com", "zscaler.com", "paloaltonetworks.com",
  "fortinet.com", "checkpoint.com", "cisco.com", "juniper.net", "arista.com",
  "vmware.com", "citrix.com", "akamai.com", "fastly.com", "datadog.com",
  "newrelic.com", "splunk.com", "elastic.co", "grafana.com", "prometheus.io",
  "hashicorp.com", "terraform.io", "ansible.com",
  "binance.com", "kraken.com", "gemini.com", "bitfinex.com", "okx.com",
  "bybit.com", "blockchain.com", "ethereum.org", "nasa.gov",
]);

/**
 * Trusted domains whose tenants are NOT controlled by the brand —
 * anyone can publish under them (GitHub Pages, Blogspot, Azure App
 * Service, …). They stay trusted for boundary and impersonation
 * purposes, but they do NOT get the phishing-check exemption:
 * "g00gle.github.io" must still be caught. (Greptile review, PR #1115.)
 */
const SHARED_PLATFORM_DOMAINS = new Set([
  "github.io", "blogspot.com", "azurewebsites.net", "tumblr.com",
  "medium.com", "substack.com", "myshopify.com", "fandom.com",
  "wikia.org",
]);

function isSharedPlatformHost(host: string): boolean {
  for (const domain of SHARED_PLATFORM_DOMAINS) {
    if (host === domain || host.endsWith(`.${domain}`)) return true;
  }
  return false;
}

/**
 * Brands protected from impersonation. Compared against leet-
 * normalized domain tokens; keep entries lowercase ASCII words.
 */
const PROTECTED_BRANDS = [
  "google", "youtube", "github", "gitlab", "bitbucket", "microsoft",
  "windows", "office", "outlook", "onedrive", "sharepoint", "openai",
  "chatgpt", "anthropic", "claude", "apple", "icloud", "paypal", "venmo",
  "amazon", "aws", "netflix", "hulu", "disney", "hbomax", "spotify",
  "facebook", "meta", "instagram", "whatsapp", "messenger", "twitter",
  "linkedin", "reddit", "pinterest", "snapchat", "tiktok", "discord",
  "telegram", "signal", "slack", "dropbox", "box", "adobe", "vercel",
  "netlify", "cloudflare", "digitalocean", "heroku", "shopify", "ebay",
  "etsy", "walmart", "target", "costco", "homedepot", "lowes", "ikea",
  "nike", "adidas", "lego", "samsung", "sony", "panasonic", "philips",
  "bosch", "siemens", "toyota", "honda", "ford", "tesla", "bmw",
  "mercedes", "audi", "volkswagen", "dell", "intel", "amd", "nvidia",
  "qualcomm", "zoom", "webex", "docusign", "atlassian", "jetbrains",
  "docker", "stackoverflow", "stackexchange", "npmjs", "pypi", "crates",
  "rubygems", "apache", "eclipse", "kernel", "ubuntu", "debian", "redhat",
  "fedora", "archlinux", "nixos", "chase", "wellsfargo", "citibank",
  "capitalone", "hsbc", "barclays", "bankofamerica", "usbank", "pnc",
  "schwab", "fidelity", "discover", "americanexpress", "visa",
  "mastercard", "ally", "n26", "wise", "revolut", "monzo", "chime",
  "imdb", "rottentomatoes", "letterboxd", "medium", "substack", "patreon",
  "kickstarter", "indiegogo", "gofundme", "eventbrite", "meetup",
  "airbnb", "uber", "lyft", "doordash", "grubhub", "instacart",
  "booking", "expedia", "kayak", "tripadvisor", "vrbo", "skyscanner",
  "hotels", "steam", "steampowered", "epicgames", "riotgames", "blizzard",
  "ubisoft", "roblox", "minecraft", "playstation", "xbox", "nintendo",
  "nordvpn", "expressvpn", "surfshark", "protonvpn", "protonmail",
  "lastpass", "onepassword", "bitwarden", "keeper", "norton", "mcafee",
  "avast", "malwarebytes", "eset", "bitdefender", "trendmicro",
  "crowdstrike", "zscaler", "paloalto", "fortinet", "checkpoint",
  "cisco", "juniper", "arista", "vmware", "citrix", "akamai", "fastly",
  "datadog", "newrelic", "splunk", "elastic", "grafana", "prometheus",
  "hashicorp", "terraform", "ansible", "binance", "kraken", "gemini",
  "bitfinex", "okx", "bybit", "blockchain", "ethereum", "wikipedia",
  "wikimedia", "wiktionary", "wikiquote", "mediawiki", "fandom",
];

/**
 * Credential-bait words. A verbatim brand token combined with one of
 * these in the same host is treated as impersonation even though the
 * brand name itself is spelled correctly.
 */
const BAIT_TOKENS = new Set([
  "login", "signin", "verify", "verification", "secure", "security",
  "account", "auth", "authenticate", "billing", "payment", "update",
  "confirm", "confirmation", "suspend", "suspended", "support",
  "recover", "recovery", "wallet", "invoice", "document", "webscr",
  "prize", "bonus", "gift", "claim", "unlock", "password", "passwort",
  "help", "center", "centre", "service", "services", "team", "official",
]);

// Leetspeak → ASCII letter. Applied to host tokens before brand
// comparison so "g00gle" and "google" compare equal while the RAW
// token is still checked for the verbatim-vs-squat distinction.
const LEET_SUBSTITUTIONS: Record<string, string> = {
  "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t",
  "8": "b", "9": "g", "@": "a", "$": "s", "!": "i", "|": "l", "+": "t",
};

function leetNormalize(s: string): string {
  return s.toLowerCase().replace(/[01345789@$!|+]/g, (c) => LEET_SUBSTITUTIONS[c] ?? c);
}

/** A candidate word inside a DNS label, raw and leet-normalized. */
interface HostToken {
  /** Lowercased piece as it appears in the hostname (pre-leet). */
  raw: string;
  /** Leetspeak-normalized form used for brand comparison. */
  norm: string;
}

/**
 * Word tokens of one DNS label. Two splits are unioned:
 *   - alphanumeric pieces catch squashed leet ("g00gle" → google,
 *     "g00gle-secure" → google + secure);
 *   - letter-only pieces catch separator-bait forms where digits act
 *     as glue ("google1login" → google + login).
 * `raw` preserves the pre-leet spelling so a real brand token is
 * distinguishable from a leetspeak squat of it.
 */
function hostTokens(label: string): HostToken[] {
  const out: HostToken[] = [];
  const seen = new Set<string>();
  const add = (piece: string) => {
    const raw = piece.toLowerCase();
    const norm = leetNormalize(raw);
    if (!norm) return;
    const key = `${raw} ${norm}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ raw, norm });
  };
  for (const piece of label.split(/[^a-z0-9]+/)) add(piece);
  for (const piece of label.split(/[^a-z]+/)) add(piece);
  return out;
}

/**
 * Letter pairs that typosquats substitute for each other and that are
 * NOT already covered by leet normalization (digits/lookalikes) or by
 * the ordinary-word guard. Kept deliberately small: a single
 * substitution only counts as a squat edit when the differing pair is
 * one of these — that is what lets "githud"→github and "paypai"→paypal
 * through while "black"→slack and "maple"→apple stay allowed.
 */
const CONFUSABLE_PAIRS = new Set([
  "bd", "cl", "dg", "ea", "eo", "il", "io", "mn", "no", "nr", "on",
  "ps", "rn", "ua", "ue", "uo", "vb",
]);

function isConfusablePair(a: string, b: string): boolean {
  const key = a < b ? `${a}${b}` : `${b}${a}`;
  return CONFUSABLE_PAIRS.has(key);
}

/**
 * True when two normalized strings differ by exactly one edit of the
 * kinds typosquats actually use: a single inserted/dropped letter
 * ("gogle", "gooogle"), an adjacent transposition ("googel"), or a
 * single substitution between confusable letters ("githud", "paypai").
 * Arbitrary single substitutions are NOT counted — post-leet they
 * mostly produce false positives on ordinary words ("black" vs
 * "slack", "maple" vs "apple").
 */
function isOneSquatEdit(a: string, b: string): boolean {
  const la = a.length;
  const lb = b.length;
  if (la < 4 || lb < 4) return false;
  if (Math.abs(la - lb) === 1) {
    const [short, long] = la < lb ? [a, b] : [b, a];
    // Indel near-misses need more evidence than substitutions or
    // transpositions: ordinary words collide at this distance
    // constantly ("team"→"steam", "metal"→"meta"), so both sides
    // must be at least 5 chars and a trailing plural "s" is never
    // an edit ("apples" is not a squat of "apple").
    if (short.length < 5 || long.length < 5) return false;
    if (long === `${short}s`) return false;
    let i = 0;
    let j = 0;
    let edits = 0;
    while (i < short.length && j < long.length) {
      if (short[i] === long[j]) {
        i++;
        j++;
        continue;
      }
      if (++edits > 1) return false;
      j++;
    }
    return edits <= 1;
  }
  if (la === lb) {
    const diffs: number[] = [];
    for (let k = 0; k < la; k++) {
      if (a[k] !== b[k]) diffs.push(k);
    }
    if (diffs.length === 1) {
      const i = diffs[0];
      return isConfusablePair(a[i], b[i]);
    }
    if (diffs.length !== 2) return false;
    const [i, j] = diffs;
    return j === i + 1 && a[i] === b[j] && a[j] === b[i];
  }
  return false;
}

interface BrandHit {
  brand: string;
  /** "squat" = leet/near-miss (blocked alone); "verbatim" needs bait. */
  kind: "squat" | "verbatim";
}

// Brands normalized once at module load for the per-token comparison.
const NORMALIZED_BRANDS = PROTECTED_BRANDS.map((b) => ({
  brand: b,
  norm: leetNormalize(b),
}));

/**
 * Compare one raw host token against the protected brands. The raw
 * (lowercased, pre-leet) token is compared verbatim first so a real
 * brand spelling is distinguished from a leetspeak squat.
 */
function matchBrand(token: HostToken): BrandHit | null {
  for (const { brand, norm } of NORMALIZED_BRANDS) {
    if (token.raw === brand) return { brand, kind: "verbatim" };
    if (token.norm === norm) return { brand, kind: "squat" };
    if (isOneSquatEdit(token.norm, norm)) return { brand, kind: "squat" };
  }
  return null;
}

/**
 * Credential/impersonation words that, glued to a brand inside a
 * single DNS token with no separator, mark a joined typosquat:
 * "g00glelogin" → google+login. Tighter than BAIT_TOKENS — these must
 * be convincing on their own, which keeps "googlemaps",
 * "steamcommunity", "dockerhub" and "metabase" allowed.
 */
const BRAND_AFFIXES = [
  "login", "signin", "verify", "verification", "account", "secure",
  "security", "auth", "billing", "payment", "update", "confirm",
  "suspend", "recover", "wallet", "invoice", "unlock", "password",
  "official", "support",
];

/** Brand-first glued form: affix alone or affix + trailing digits. */
const BRAND_AFFIX_PREFIX_RE = new RegExp(
  `^(?:${BRAND_AFFIXES.join("|")})[0-9]*$`,
);

/**
 * A brand glued to a credential word inside ONE token — the shape
 * token-splitting cannot see ("g00glelogin.com" is a single alnum
 * piece). The brand may lead ("googlelogin", "googlelogin2024") or
 * trail ("accountgoogle"); the glued-on side must be an affix.
 */
function matchJoinedBrand(token: HostToken): BrandHit | null {
  const t = token.norm;
  for (const { brand, norm } of NORMALIZED_BRANDS) {
    if (t.length <= norm.length) continue;
    // The glued-on brand may itself be a near-miss ("netfl1xofficial"
    // → netflix+official), so compare the fixed-width head/tail with
    // the same one-edit rule used for whole tokens.
    const head = t.slice(0, norm.length);
    const rest = t.slice(norm.length);
    if (
      (head === norm || isOneSquatEdit(head, norm)) &&
      BRAND_AFFIX_PREFIX_RE.test(rest)
    ) {
      return { brand, kind: "squat" };
    }
    const tail = t.slice(t.length - norm.length);
    const lead = t.slice(0, t.length - norm.length);
    if (
      (tail === norm || isOneSquatEdit(tail, norm)) &&
      BRAND_AFFIXES.some((a) => lead === a || lead.endsWith(a))
    ) {
      return { brand, kind: "squat" };
    }
  }
  return null;
}

/**
 * Explicit TRUSTED_DOMAINS match only — no .gov/.mil/.edu suffix
 * tier. Used for the early structural exemption: a verified domain
 * like "google.com.au" legitimately starts with the shorter trusted
 * name "google.com.", and must not be flagged as impersonation.
 */
function isExplicitTrustedHost(host: string): boolean {
  for (const domain of TRUSTED_DOMAINS) {
    if (host === domain || host.endsWith(`.${domain}`)) return true;
  }
  return false;
}

/** Trusted-domain check on a DNS label boundary. */
function isTrustedHost(host: string): boolean {
  if (isExplicitTrustedHost(host)) return true;
  // Restricted public suffixes are legitimate only as the final
  // label(s): "whitehouse.gov" and "cam.ac.uk" pass, "state.gov.
  // evil.com" does not (it does not END with the suffix).
  for (const tld of [".gov", ".mil", ".edu", ".ac.uk", ".edu.au", ".edu.cn", ".ac.jp", ".ac.in"]) {
    if (host.endsWith(tld)) return true;
  }
  return false;
}

/**
 * A trusted domain used as a NON-FINAL part of the host:
 * "google.com.evil.com" or "accounts.google.com.phish.net". The real
 * domain only ever appears at the end of a hostname.
 */
function impersonatedDomain(host: string): string | null {
  for (const domain of TRUSTED_DOMAINS) {
    if (host.startsWith(`${domain}.`) || host.includes(`.${domain}.`)) {
      return domain;
    }
  }
  return null;
}

/**
 * Restricted TLD (.gov/.mil/.edu) appearing before the final label:
 * "state.gov.evil.com". Legitimate second-level suffixes put a bare
 * ccTLD after the restricted label — "service.gov.uk",
 * "unimelb.edu.au" — so a match only counts when MORE than a single
 * 2-letter label follows the TLD. (Greptile review, PR #1115.)
 */
function deceptiveRestrictedTld(host: string): boolean {
  for (const tld of ["gov", "mil", "edu"]) {
    const re = new RegExp(`(?:^|\\.)${tld}\\.`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(host)) !== null) {
      const rest = host.slice(m.index + m[0].length);
      if (!/^[a-z]{2}$/.test(rest)) return true;
    }
  }
  return false;
}

// Credential-bait hostname patterns that stay simple substring checks:
// hyphenated brand squats, credential-harvesting phrasing, and the IDN
// (punycode) homograph prefix. None of these match the verified
// legitimate spellings (paypal.com, microsoft.com, …).
const PHISHING_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /pay-pal/i, label: "typosquat of a payment brand" },
  { pattern: /apple[-.]?id/i, label: "credential-harvesting pattern" },
  { pattern: /micorsoft/i, label: "typosquat of a tech brand" },
  { pattern: /chase[-.]?bank/i, label: "credential-harvesting pattern" },
  { pattern: /wells[-.]?fargo/i, label: "credential-harvesting pattern" },
  { pattern: /verify[-.]?account/i, label: "credential-bait phrasing" },
  { pattern: /account[-.]?suspended/i, label: "credential-bait phrasing" },
  { pattern: /secure[-.]?login/i, label: "credential-bait phrasing" },
  { pattern: /login[-.]?verify/i, label: "credential-bait phrasing" },
  { pattern: /signin[-.]?confirm/i, label: "credential-bait phrasing" },
  { pattern: /(^|\.)xn--/i, label: "IDN homograph (punycode) domain" },
];

// Literal-IP classification lives in ip-address-safety.ts — the same
// classifier the proxy's DNS-resolution layer applies to resolved
// addresses, so literal and resolved destinations get identical
// treatment (private, CGNAT, ULA, NAT64, transition mechanisms, …).

/**
 * Apply the navigate-time URL policy.
 *
 * Accepts a raw or normalized URL string; rejects anything that is not a
 * loadable http(s) URL, then inspects the host against the block rules.
 */
export function checkBrowserUrlPolicy(raw: string): BrowserUrlPolicyResult {
  const normalized = normalizeBrowserUrl(raw);
  if (!normalized) {
    return {
      allowed: false,
      reason: `"${(raw ?? "").trim()}" is not a valid http(s) web address`,
    };
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return { allowed: false, reason: "unparseable URL" };
  }

  // Hostnames are case-insensitive and may carry a trailing root dot
  // ("google.com."); normalize both away before any boundary check.
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (!host) {
    return { allowed: false, reason: "URL has no host", host };
  }

  // localhost and its aliases
  if (host === "localhost" || host.endsWith(".localhost")) {
    return { allowed: false, reason: "localhost is not browsable", host };
  }

  // Cloud metadata hostnames
  if (METADATA_HOSTNAMES.has(host)) {
    return { allowed: false, reason: "cloud metadata endpoint", host };
  }

  // Literal IP checks (no DNS resolution at this layer — documented
  // above; the proxy route separately resolves and validates every
  // address a hostname maps to before connecting).
  const ipReason = ipBlockReason(host);
  if (ipReason) {
    return { allowed: false, reason: ipReason, host };
  }

  // Verified explicit domains are exempt from the structural
  // impersonation heuristics: "google.com.au" legitimately begins
  // with the shorter trusted name "google.com.". Shared platforms
  // (github.io, blogspot.com, …) stay fully checked — their tenants
  // are attacker-controlled. The .gov/.mil/.edu suffix tier is NOT
  // exempt here; those hosts still face the structural checks below.
  if (isExplicitTrustedHost(host) && !isSharedPlatformHost(host)) {
    return { allowed: true, host };
  }

  // Deceptive structure is checked BEFORE the trusted-domain
  // exemption: a trusted name or restricted TLD appearing as a
  // non-final label is phishing regardless of what the final suffix
  // is ("google.com.evil.edu", "state.gov.evil.com").
  const impersonated = impersonatedDomain(host);
  if (impersonated) {
    return {
      allowed: false,
      reason: `blocked by phishing policy (deceptive subdomain impersonating ${impersonated})`,
      host,
    };
  }
  if (deceptiveRestrictedTld(host)) {
    return {
      allowed: false,
      reason: "blocked by phishing policy (restricted TLD used mid-host)",
      host,
    };
  }

  // Verified legitimate domains are exempt from the remaining
  // impersonation checks (typosquat tokens, credential-bait phrasing,
  // punycode) — this is what separates google.com from g00gle.com and
  // keeps real institutional login pages like secure-login.mit.edu
  // working. Shared-platform domains (github.io, blogspot.com, …) are
  // trusted for structure but NOT exempt: their tenants are
  // attacker-controlled, so "g00gle.github.io" still faces the full
  // phishing checks. localhost / metadata / literal-IP rules above
  // still apply to every host, trusted or not.
  if (isTrustedHost(host) && !isSharedPlatformHost(host)) {
    return { allowed: true, host };
  }

  // Credential-phishing patterns
  for (const { pattern, label } of PHISHING_PATTERNS) {
    if (pattern.test(host)) {
      return {
        allowed: false,
        reason: `blocked by phishing policy (${label})`,
        host,
      };
    }
  }

  // Token-level brand analysis: squats block on their own; a verbatim
  // brand token only blocks alongside credential-bait wording.
  const tokens = host.split(".").flatMap(hostTokens);
  let verbatimBrand: string | null = null;
  for (const token of tokens) {
    const hit = matchBrand(token) ?? matchJoinedBrand(token);
    if (!hit) continue;
    if (hit.kind === "squat") {
      return {
        allowed: false,
        reason: `blocked by phishing policy (typosquat of "${hit.brand}")`,
        host,
      };
    }
    verbatimBrand = verbatimBrand ?? hit.brand;
  }
  if (verbatimBrand && tokens.some((t) => BAIT_TOKENS.has(t.norm))) {
    return {
      allowed: false,
      reason: `blocked by phishing policy ("${verbatimBrand}" combined with credential-bait wording)`,
      host,
    };
  }

  return { allowed: true, host };
}
