const KNOWN_BOT_UA = [/bot/i, /spider/i, /crawler/i, /APIs-Google/i, /BingPreview/i, /Pingdom/i];

export function isLikelyBot(req: Request) {
  const ua = req.headers.get('user-agent') || '';
  if (!ua || ua.trim().length < 3) return true;
  for (const re of KNOWN_BOT_UA) {
    if (re.test(ua)) return true;
  }
  if (req.headers.get('x-scraper') || req.headers.get('x-automation')) return true;
  return false;
}
