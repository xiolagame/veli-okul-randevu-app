import appleBadge from './store-downloads/apple.svg';
import googleBadge from './store-downloads/google.png';
import appleQr from './store-downloads/apple-qr.svg';
import googleQr from './store-downloads/google-qr.svg';

// Official Apple Marketing Tools and Google Play badges, served locally.
const stores = [
  {
    name: 'App Store',
    device: 'iPhone ve iPad için',
    url: 'https://apps.apple.com/tr/app/veli-randevu/id6823597940?l=tr',
    badge: appleBadge,
    qr: appleQr,
  },
  {
    name: 'Google Play',
    device: 'Android için',
    url: 'https://play.google.com/store/apps/details?id=com.velirandevu.app',
    badge: googleBadge,
    qr: googleQr,
  },
];

export function WebStoreDownloads() {
  return (
    <section className="welcome-downloads" aria-label="Mobil uygulamayı indirin">
      <h2>Mobil uygulamayı indirin</h2>
      <div className="welcome-store-grid">
        {stores.map(({ name, device, url, badge, qr }) => (
          <a className="welcome-store-card" key={name} href={url}
            aria-label={`Veli Randevu · ${name} · ${device}`}>
            <img className="welcome-store-badge" src={badge} alt="" />
            <span>{device}</span>
            <img className="welcome-store-qr" src={qr} alt="" width="96" height="96" />
          </a>
        ))}
      </div>
    </section>
  );
}
