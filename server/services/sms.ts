// ==============================================================================
// VELİ - OKUL RANDEVU SİSTEMİ: SMS SERVICE ABSTRACTION (FAZ 20)
// Supports Netgsm (Production standard for MEB schools), Mock (Dev only)
// ==============================================================================

export interface SmsSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface ISmsProvider {
  name: string;
  sendOtp(phone: string, code: string): Promise<SmsSendResult>;
  sendAppointmentNotification(phone: string, message: string): Promise<SmsSendResult>;
}

/**
 * Mock SMS Provider: Allowed ONLY in development/test environment.
 * Throws an error if attempted in production mode.
 */
export class MockSmsProvider implements ISmsProvider {
  name = 'mock';

  constructor() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'KRİTİK GÜVENLİK HATASI: MockSmsProvider production modunda kesinlikle kullanılamaz! Lütfen SMS_PROVIDER=netgsm ve ilgili API anahtarlarını yapılandırınız.'
      );
    }
  }

  async sendOtp(phone: string, code: string): Promise<SmsSendResult> {
    const timestamp = new Date().toISOString();
    console.log(`[DEV SMS SIMULATION - ${timestamp}] Gönderilen Tel: ${phone} | OTP Kodu: ${code}`);
    return {
      success: true,
      messageId: `mock-otp-${Date.now()}`,
    };
  }

  async sendAppointmentNotification(phone: string, message: string): Promise<SmsSendResult> {
    const timestamp = new Date().toISOString();
    console.log(`[DEV SMS NOTIFICATION - ${timestamp}] Gönderilen Tel: ${phone} | Mesaj: ${message}`);
    return {
      success: true,
      messageId: `mock-notif-${Date.now()}`,
    };
  }
}

/**
 * Netgsm SMS Provider:
 * Production standard provider widely utilized across MEB schools in Turkey.
 * Communicates via official Netgsm REST XML / JSON Gateway API.
 */
export class NetgsmSmsProvider implements ISmsProvider {
  name = 'netgsm';
  private usercode: string;
  private password: string;
  private header: string;

  constructor() {
    this.usercode = process.env.SMS_API_KEY || process.env.NETGSM_USERCODE || '';
    this.password = process.env.SMS_API_SECRET || process.env.NETGSM_PASSWORD || '';
    this.header = process.env.SMS_SENDER || process.env.NETGSM_HEADER || 'OKULRANDEVU';

    if (process.env.NODE_ENV === 'production' && (!this.usercode || !this.password)) {
      throw new Error(
        'KRİTİK GÜVENLİK HATASI: Netgsm SMS sağlayıcısı için SMS_API_KEY ve SMS_API_SECRET ortam değişkenleri tanımlanmamış!'
      );
    }
  }

  async sendOtp(phone: string, code: string): Promise<SmsSendResult> {
    const cleanPhone = phone.replace(/\D/g, '');
    const message = `Veli-Okul Randevu Sistemi giriş doğrulama kodunuz: ${code}. Bu kodu kimseyle paylaşmayınız.`;

    if (!this.usercode || !this.password) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[NETGSM WARN] API kimlik bilgileri eksik, dev ortamında simülasyon yapılıyor.');
        return { success: true, messageId: `netgsm-sim-${Date.now()}` };
      }
      return { success: false, error: 'Netgsm API kimlik bilgileri eksik.' };
    }

    try {
      // Netgsm REST API endpoint
      const response = await fetch('https://api.netgsm.com.tr/sms/send/get', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          usercode: this.usercode,
          password: this.password,
          gsmno: cleanPhone,
          message: message,
          msgheader: this.header,
        }).toString(),
      });

      const responseText = await response.text();
      // Netgsm returns "00 <jobId>" on success
      if (responseText.startsWith('00') || responseText.startsWith('01') || responseText.startsWith('02')) {
        return { success: true, messageId: responseText.trim() };
      }

      return {
        success: false,
        error: `Netgsm Hata Kodu: ${responseText.trim()}`,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Netgsm bağlantı hatası: ${err.message}`,
      };
    }
  }

  async sendAppointmentNotification(phone: string, message: string): Promise<SmsSendResult> {
    const cleanPhone = phone.replace(/\D/g, '');

    if (!this.usercode || !this.password) {
      if (process.env.NODE_ENV !== 'production') {
        return { success: true, messageId: `netgsm-sim-${Date.now()}` };
      }
      return { success: false, error: 'Netgsm API kimlik bilgileri eksik.' };
    }

    try {
      const response = await fetch('https://api.netgsm.com.tr/sms/send/get', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          usercode: this.usercode,
          password: this.password,
          gsmno: cleanPhone,
          message: message,
          msgheader: this.header,
        }).toString(),
      });

      const responseText = await response.text();
      if (responseText.startsWith('00') || responseText.startsWith('01') || responseText.startsWith('02')) {
        return { success: true, messageId: responseText.trim() };
      }

      return { success: false, error: `Netgsm Hata: ${responseText.trim()}` };
    } catch (err: any) {
      return { success: false, error: `Netgsm Hatası: ${err.message}` };
    }
  }
}

/**
 * SMS Provider Factory
 * Enforces production fail-fast requirements.
 */
let smsProviderInstance: ISmsProvider | null = null;

export function getSmsProvider(): ISmsProvider {
  if (smsProviderInstance) {
    return smsProviderInstance;
  }

  const requestedProvider = (process.env.SMS_PROVIDER || (process.env.NODE_ENV === 'production' ? 'netgsm' : 'mock')).toLowerCase();

  if (process.env.NODE_ENV === 'production') {
    if (requestedProvider === 'mock') {
      throw new Error(
        'KRİTİK GÜVENLİK KURALI İHLALİ: Production ortamında SMS_PROVIDER=mock kabul edilemez! SMS sağlayıcısını "netgsm" olarak ayarlayınız.'
      );
    }
    smsProviderInstance = new NetgsmSmsProvider();
  } else {
    if (requestedProvider === 'netgsm') {
      smsProviderInstance = new NetgsmSmsProvider();
    } else {
      smsProviderInstance = new MockSmsProvider();
    }
  }

  return smsProviderInstance;
}
