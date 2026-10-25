const PROVIDER_TIMEOUT_MS = 8_000;

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text?: string;
  idempotencyKey?: string;
}

export async function sendEmail(message: OutboundEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) throw new Error('Email provider is not configured.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json',
      ...(message.idempotencyKey ? { 'Idempotency-Key': message.idempotencyKey } : {}) },
    body: JSON.stringify({ from, to: [message.to], subject: message.subject, html: message.html, ...(message.text ? { text: message.text } : {}) }),
  });
  if (!response.ok) throw new Error('Email provider rejected the message.');
}
