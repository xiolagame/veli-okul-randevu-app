export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(message: OutboundEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) throw new Error('Email provider is not configured.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [message.to], subject: message.subject, html: message.html }),
  });
  if (!response.ok) throw new Error('Email provider rejected the message.');
}
