import type { WhatsAppDeliveryItem } from '../types/platform';

// Meta hata kodlarının sade Türkçe karşılığı. Listede olmayan kodlarda Meta'nın kendi başlığı gösterilir.
const ERROR_EXPLANATIONS: Record<number, string> = {
  131026: 'Mesaj bu numaraya teslim edilemedi. Numarada WhatsApp olmayabilir, uygulama eski olabilir veya WhatsApp koşulları onaylanmamış olabilir.',
  131042: 'WhatsApp işletme hesabında ödeme sorunu var. Meta panelindeki ödeme ayarlarını kontrol edin.',
  131048: 'Meta, çok fazla mesaj nedeniyle gönderimi geçici olarak sınırladı.',
  131049: 'Meta bu mesajı iletmemeyi seçti. Bir süre sonra tekrar deneyin.',
  131056: 'Bu numaraya kısa sürede çok fazla mesaj gönderildi. Bir süre bekleyip tekrar deneyin.',
  132001: 'WhatsApp mesaj şablonu bulunamadı veya onaylı değil.',
  132015: 'WhatsApp mesaj şablonu Meta tarafından duraklatıldı.',
  132016: 'WhatsApp mesaj şablonu Meta tarafından kapatıldı.',
};

export function describeWhatsAppDelivery(item: Pick<WhatsAppDeliveryItem, 'status' | 'errorCode' | 'errorTitle'>): { label: string; tone: 'success' | 'warning' | 'danger' | 'info'; explanation: string } {
  if (item.status === 'read') return { label: 'Okundu', tone: 'success', explanation: '' };
  if (item.status === 'delivered') return { label: 'Telefona ulaştı', tone: 'success', explanation: '' };
  if (item.status === 'sent') return { label: 'Gönderildi, henüz ulaşmadı', tone: 'warning', explanation: '' };
  const known = item.errorCode ? ERROR_EXPLANATIONS[item.errorCode] : '';
  const detail = known || item.errorTitle || 'Meta neden bildirmedi.';
  return { label: 'Ulaşmadı', tone: 'danger', explanation: item.errorCode ? `${detail} (Kod ${item.errorCode})` : detail };
}
