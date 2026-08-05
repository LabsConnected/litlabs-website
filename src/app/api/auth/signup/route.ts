import { NextResponse } from 'next/server';
import { withRateLimit } from '@/lib/withRateLimit';
import { isLikelyBot } from '@/lib/bot-detect';
import { verifyTurnstileToken } from '@/lib/turnstile';
import { alertLog } from '@/lib/alerts';

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    turnstileToken?: string;
  };
  const { turnstileToken } = body;

  if (isLikelyBot(req)) {
    await alertLog('bot_detected_signup', { ip });
    return NextResponse.json({ error: 'bot_detected' }, { status: 403 });
  }

  const rl = await withRateLimit({ key: `signup:${ip}`, tier: 'auth' });
  if (rl) return rl;

  const verify = await verifyTurnstileToken(turnstileToken ?? '', ip);
  if (!verify.success) {
    await alertLog('turnstile_failed_signup', { ip, detail: verify['error-codes'] });
    return NextResponse.json({ error: 'captcha_failed' }, { status: 403 });
  }

  // TODO: replace with your Clerk / auth signup logic
  return NextResponse.json({ ok: true });
}
