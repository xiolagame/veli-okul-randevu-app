import { getPublicOrigin } from './public-origin';

export interface EmailInfoCard {
  label: string;
  textLabel?: string;
  value: string;
  tone?: 'default' | 'accent';
}

export interface BrandedEmailContent {
  subtitle: string;
  preheader?: string;
  verificationCode?: EmailInfoCard;
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

export function verificationEmailSubject(code: string): string {
  // Codes are generated server-side. Strip header control characters; never log them.
  return `Doğrulama kodunuz: ${code.replace(/[\u0000-\u001f\u007f]/g, '')}`;
}

export function renderBrandedEmail(content: BrandedEmailContent): { html: string; text: string } {
  const safeSubtitle = escapeEmailHtml(content.subtitle);
  const preview = (content.preheader || (content.verificationCode ? verificationEmailSubject(content.verificationCode.value) : content.intro[0]) || content.subtitle).replace(/\s+/g, ' ').trim().slice(0, 180);
  const preheader = `<div data-email-preheader aria-hidden="true" style="display:none!important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;color:transparent">${escapeEmailHtml(preview)}<span>${'&#8204;&nbsp;'.repeat(120)}</span></div>`;
  const greeting = content.greeting
    ? `<p style="margin:0 0 14px;font-size:16px;line-height:24px;color:#17332b">Merhaba <strong>${escapeEmailHtml(content.greeting)}</strong>,</p>`
    : '';
  const paragraphs = content.intro.map((paragraph) =>
    `<p style="margin:0 0 12px;font-size:15px;line-height:24px;color:#475569">${escapeEmailHtml(paragraph)}</p>`).join('');
  const renderCard = (card: EmailInfoCard, verification = false) => {
    const accent = card.tone === 'accent';
    return `<tr${verification ? ' data-email-code' : ''}><td style="padding:${verification ? '22px 24px 0' : '0 24px 16px'}"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${accent ? '#fff7ed' : '#f8fafc'};border:1px solid ${accent ? '#fed7aa' : '#e2e8f0'};border-radius:16px"><tr><td style="padding:18px 12px;text-align:center"><div style="font-size:12px;line-height:18px;font-weight:700;letter-spacing:1px;color:${accent ? '#c2410c' : '#64748b'}">${escapeEmailHtml(card.label.toLocaleUpperCase('tr-TR'))}</div><div style="margin-top:6px;font-size:${verification ? '34px' : '24px'};line-height:40px;font-weight:800;letter-spacing:${verification ? '5px' : '1px'};overflow-wrap:anywhere;word-break:break-word;color:${accent ? '#7c2d12' : '#0f172a'}">${escapeEmailHtml(card.value)}</div></td></tr></table></td></tr>`;
  };
  const code = content.verificationCode ? renderCard(content.verificationCode, true) : '';
  const cards = content.infoCards?.map(card => renderCard(card)).join('') || '';
  const action = content.action
    ? `<p style="margin:20px 0 0;text-align:center"><a href="${escapeEmailHtml(content.action.url)}" style="display:inline-block;padding:13px 22px;border-radius:12px;background:#047857;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700">${escapeEmailHtml(content.action.label)}</a></p>`
    : '';
  const notice = content.notice
    ? `<p style="margin:18px 0 0;font-size:13px;line-height:20px;color:#64748b">${escapeEmailHtml(content.notice)}</p>`
    : '';
  const trailingNotice = content.verificationCode ? '' : notice;
  const text = [
    ...(content.verificationCode ? [`${content.verificationCode.textLabel || content.verificationCode.label}: ${content.verificationCode.value}`] : []),
    content.subtitle, '',
    ...(content.greeting ? [`Merhaba ${content.greeting},`, ''] : []),
    ...content.intro,
    ...(content.verificationCode && content.notice ? ['', content.notice] : []),
    ...(content.infoCards?.flatMap((card) => [`${card.textLabel || card.label}: ${card.value}`]) || []),
    ...(content.action ? ['', `${content.action.label}: ${content.action.url}`] : []),
    ...(!content.verificationCode && content.notice ? ['', content.notice] : []),
    '', 'VELİ RANDEVU',
  ].join('\n');
  return {
    text,
    html: `<!doctype html><html lang="tr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeSubtitle}</title></head><body style="margin:0;padding:0;background:#e8eef0;font-family:Arial,sans-serif;overflow-wrap:anywhere;word-break:break-word;color:#17332b">${preheader}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#e8eef0"><tr><td align="center" style="padding:16px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden"><tr><td style="padding:18px 24px;background:#064e3b;text-align:center"><img src="${escapeEmailHtml(getEmailLogoUrl())}" width="40" height="40" alt="Veli Randevu" style="display:block;margin:0 auto 8px;max-width:40px;height:auto"><h1 style="margin:0;font-size:19px;line-height:26px;color:#ffffff">${safeSubtitle}</h1></td></tr>${code}<tr><td style="padding:24px 24px 12px">${greeting}${paragraphs}${content.verificationCode ? notice : ''}</td></tr>${cards}${action || trailingNotice ? `<tr><td style="padding:0 24px 24px">${action}${trailingNotice}</td></tr>` : ''}<tr><td style="padding:16px 24px;background:#f8fafc;text-align:center;font-size:12px;line-height:18px;color:#64748b">Veli Randevu</td></tr></table></td></tr></table></body></html>`,
  };
}
