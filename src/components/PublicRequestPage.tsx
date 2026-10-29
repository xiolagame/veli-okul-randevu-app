import React from 'react';
import { ArrowLeft, BadgeHelp } from 'lucide-react';
import { getPublicRequestPreset } from '../utils/public-request-route';
import { Button } from './ui';
import { PublicRequestSection } from './PublicRequestSection';

export function PublicRequestPage({ onBack, backLabel = 'Giriş ekranına dön' }: { onBack: () => void; backLabel?: string }) {
  const initialRequestType = getPublicRequestPreset(window.location.search);

  return <main className="public-request-page">
    <div className="public-request-page-shell">
      <header className="public-request-page-header">
        <Button variant="quiet" className="public-page-back" onClick={onBack}><ArrowLeft size={18} />{backLabel}</Button>
      </header>
      <section className="public-request-page-card" aria-labelledby="public-request-page-title">
        <div className="public-request-page-copy">
          <span className="public-request-page-icon"><BadgeHelp size={24} aria-hidden="true" /></span>
          <div>
            <h1 id="public-request-page-title">Lisans / İletişim</h1>
            <p>Lisans seçenekleri hakkında bilgi almak veya bizimle iletişime geçmek için talep oluşturabilirsiniz.</p>
          </div>
        </div>
        <PublicRequestSection initialRequestType={initialRequestType} onBack={onBack} backLabel={backLabel} />
      </section>
    </div>
  </main>;
}
