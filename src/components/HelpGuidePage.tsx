import React from 'react';
import { ArrowLeft } from 'lucide-react';
import type { HelpGuide } from '../content/help-content';
import { Button } from './ui';

interface HelpGuidePageProps {
  guide: HelpGuide;
  onBack: () => void;
}

export function HelpGuidePage({ guide, onBack }: HelpGuidePageProps) {
  return <>
    <Button variant="quiet" className="help-back" onClick={onBack}><ArrowLeft size={18} />Yardım merkezine dön</Button>
    <article className="help-guide" aria-labelledby="help-guide-title">
      <header className="help-guide-heading">
        <p className="eyebrow">{guide.eyebrow}</p>
        <h1 id="help-guide-title">{guide.title}</h1>
        <p>{guide.description}</p>
      </header>
      <div className="help-guide-sections">
        {guide.sections.map((section) => <section key={section.title} className="help-guide-section">
          <h2>{section.title}</h2>
          {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          {section.steps && <ol>{section.steps.map((step) => <li key={step}>{step}</li>)}</ol>}
          {section.bullets && <ul>{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}
          {section.note && <aside className="help-note">{section.note}</aside>}
        </section>)}
      </div>
    </article>
  </>;
}
