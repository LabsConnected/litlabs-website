export async function alertLog(event: string, meta: Record<string, unknown>) {
  try {
    if (process.env.SLACK_ALERT_WEBHOOK) {
      await fetch(process.env.SLACK_ALERT_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `${event} — ${JSON.stringify(meta)}` }),
      });
    }
  } catch (e) {
    console.error('alertLog failed', e);
  }
}
