import { NextResponse } from 'next/server';
import { withRateLimit } from '@/lib/withRateLimit';
import { isLikelyBot } from '@/lib/bot-detect';
import { alertLog } from '@/lib/alerts';

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const body = await req.json().catch(() => ({}));

  if (isLikelyBot(req)) {
    await alertLog('bot_detected_provider_execute', { ip });
    return NextResponse.json({ error: 'bot_detected' }, { status: 403 });
  }

  const key = `ai:ip:${ip}`;
  const rl = await withRateLimit({ key, tier: 'ai' });
  if (rl) return rl;

  // Provider execution must be wired to a real billing + auth path.
  // Returning success without executing is a silent failure.
  return NextResponse.json(
    { error: "not_implemented", detail: "Provider execute is not wired" },
    { status: 501 }
  );
}
