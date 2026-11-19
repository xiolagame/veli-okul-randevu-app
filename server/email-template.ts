import { getPublicOrigin } from './public-origin';

export interface EmailInfoCard {
  label: string;
  textLabel?: string;
  value: string;
  tone?: 'default' | 'accent';
}

export interface BrandedEmailContent {
  subtitle: string;
  greeting?: string;
  intro: string[];
  infoCards?: EmailInfoCard[];
  action?: { label: string; url: string };
  notice?: string;
}

export function escapeEmailHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

export function getEmailLogoUrl(): string {
  return `${getPublicOrigin()}/branding/veli-randevu-logo.png`;
}

export function renderBrandedEmail(content: BrandedEmailContent): { html: string; text: string } {
  const safeSubtitle = escapeEmailHtml(content.subtitle);
  const greeting = content.greeting
    ? `<p style="margin:0 0 14px;font-size:16px;line-height:24px;color:#17332b">Merhaba <strong>${escapeEmailHtml(content.greeting)}</strong>,</p>`
    : '';
  const paragraphs = content.intro.map((paragraph) =>
    `<p style="margin:0 0 12px;font-size:15px;line-height:24px;color:#475569">${escapeEmailHtml(paragraph)}</p>`).join('');
  const cards = content.infoCards?.map((card) => {
    const accent = card.tone === 'accent';
    return `<tr><td style="padding:0 32px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${accent ? '#fff7ed' : '#f8fafc'};border:1px solid ${accent ? '#fed7aa' : '#e2e8f0'};border-radius:16px"><tr><td style="padding:18px;text-align:center"><div style="font-size:12px;line-height:18px;font-weight:700;letter-spacing:1.4px;color:${accent ? '#c2410c' : '#64748b'}">${escapeEmailHtml(card.label.toLocaleUpperCase('tr-TR'))}</div><div style="margin-top:6px;font-size:${accent ? '28px' : '26px'};line-height:36px;font-weight:800;letter-spacing:${accent ? '4px' : '2px'};color:${accent ? '#7c2d12' : '#0f172a'}">${escapeEmailHtml(card.value)}</div></td></tr></table></td></tr>`;
  }).join('') || '';
  const action = content.action
    ? `<p style="margin:20px 0 0;text-align:center"><a href="${escapeEmailHtml(content.action.url)}" style="display:inline-block;padding:13px 22px;border-radius:12px;background:#047857;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700">${escapeEmailHtml(content.action.label)}</a></p>`
    : '';
  const notice = content.notice
    ? `<p style="margin:18px 0 0;font-size:13px;line-height:20px;color:#64748b">${escapeEmailHtml(content.notice)}</p>`
    : '';
  const text = [
    'VELİ RANDEVU', content.subtitle, '',
    ...(content.greeting ? [`Merhaba ${content.greeting},`, ''] : []),
    ...content.intro,
    ...(content.infoCards?.flatMap((card) => [`${card.textLabel || card.label}: ${card.value}`]) || []),
    ...(content.action ? ['', `${content.action.label}: ${content.action.url}`] : []),
    ...(content.notice ? ['', content.notice] : []),
    '', 'Veli Randevu · Okul Veli Randevu Sistemi',
  ].join('\n');
  return {
    text,
    html: `<!doctype html><html><body style="margin:0;padding:0;background:#e8eef0;font-family:Arial,sans-serif;color:#17332b"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#e8eef0"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:22px;overflow:hidden;box-shadow:0 12px 34px rgba(15,64,52,.14)"><tr><td style="padding:28px 32px;background:#064e3b;text-align:center"><img src="${escapeEmailHtml(getEmailLogoUrl())}" width="72" height="72" alt="Veli Randevu" style="display:block;margin:0 auto 12px;max-width:72px;height:auto"><div style="font-size:24px;line-height:30px;font-weight:800;color:#ffffff">VELİ RANDEVU</div><div style="margin-top:5px;font-size:14px;line-height:20px;color:#d1fae5">${safeSubtitle}</div></td></tr><tr><td style="padding:30px 32px 18px">${greeting}${paragraphs}</td></tr>${cards}${action || notice ? `<tr><td style="padding:0 32px 30px">${action}${notice}</td></tr>` : ''}<tr><td style="padding:18px 32px;background:#f8fafc;text-align:center;font-size:12px;line-height:18px;color:#64748b">Veli Randevu · Okul Veli Randevu Sistemi</td></tr></table></td></tr></table></body></html>`,
  };
}
