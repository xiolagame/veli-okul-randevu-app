import React from 'react';
import { ArrowLeft, ArrowRight, BookOpen, FileText, LifeBuoy, ShieldCheck } from 'lucide-react';
import { getHelpGuide, helpCategories } from '../content/help-content';
import { getHelpSlug, HELP_PATH } from '../utils/public-request-route';
import { Brand, Button } from './ui';
import { HelpGuidePage } from './HelpGuidePage';

interface HelpCenterPageProps {
  pathname: string;
  isAuthenticated: boolean;
  isPlatformAdmin?: boolean;
  onBack: () => void;
  onGuideBack: () => void;
  onNavigate: (path: string) => void;
}

const categoryIcons = {
  book: BookOpen,
  shield: ShieldCheck,
  file: FileText,
  support: LifeBuoy,
};

function HelpLink({ path, onNavigate, children, className = '' }: { path: string; onNavigate: (path: string) => void; children: React.ReactNode; className?: string }) {
  return <a href={path} className={className} onClick={(event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(path);
  }}>{children}</a>;
}

export function HelpCenterPage({ pathname, isAuthenticated, isPlatformAdmin = false, onBack, onGuideBack, onNavigate }: HelpCenterPageProps) {
  const slug = getHelpSlug(pathname);
  const guide = getHelpGuide(slug);

  return <main className="help-page">
    <div className="help-page-shell">
      <header className="help-page-header">
        <Brand />
        <Button variant="quiet" onClick={onBack}><ArrowLeft size={18} />{isAuthenticated ? 'Uygulamaya dön' : 'Giriş ekranına dön'}</Button>
      </header>
      {slug && guide
        ? <HelpGuidePage guide={guide} onBack={onGuideBack} />
        : <>
          {slug && !guide && <section className="help-not-found" role="status"><h1>Yardım sayfası bulunamadı</h1><p>Aradığınız başlık taşınmış veya henüz yayınlanmamış olabilir.</p><Button onClick={() => onNavigate(HELP_PATH)}>Yardım merkezine dön</Button></section>}
          {!slug && <>
            <section className="help-hero" aria-labelledby="help-center-title">
              <span className="help-hero-icon"><BookOpen size={28} aria-hidden="true" /></span>
              <div><p className="eyebrow">VELİ RANDEVU</p><h1 id="help-center-title">Yardım ve Bilgilendirme</h1><p>Veli Randevu kullanımı, hesap işlemleri, gizlilik ve yasal bilgilere buradan ulaşabilirsiniz.</p></div>
            </section>
            <div className="help-category-grid">
              {helpCategories.map((category) => {
                const Icon = categoryIcons[category.icon];
                return <section key={category.id} className="help-category" aria-labelledby={`help-category-${category.id}`}>
                  <header><span><Icon size={22} aria-hidden="true" /></span><div><h2 id={`help-category-${category.id}`}>{category.title}</h2><p>{category.description}</p></div></header>
                  <nav aria-label={category.title}>
                    {category.items.map((item) => {
                      const path = item.path ?? `${HELP_PATH}/${item.slug}`;
                      return <HelpLink key={path} path={path} onNavigate={onNavigate} className="help-topic-link">
                      <span><strong>{item.title}</strong><small>{item.description}</small></span><ArrowRight size={18} aria-hidden="true" />
                      </HelpLink>;
                    })}
                  </nav>
                </section>;
              })}
            </div>
            {isAuthenticated && isPlatformAdmin && <p className="help-platform-note">Platform yöneticileri genel yardım ve bilgilendirme içeriklerine erişebilir. Bu fazda ayrı bir Platform Yönetimi kullanım rehberi yayınlanmamıştır.</p>}
          </>}
        </>}
    </div>
  </main>;
}
