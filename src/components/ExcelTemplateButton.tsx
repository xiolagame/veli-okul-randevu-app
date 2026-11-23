import React, { useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from './ui';
import { ExcelTemplate, TEMPLATE_DOWNLOAD_ERROR, downloadTemplate } from '../utils/excel-templates';

// Web: verified download as a real .xlsx. Android/iOS app: the file opens in the system browser, because
// native WebViews cannot save blobs or honour <a download>.
export const ExcelTemplateButton: React.FC<{
  template: ExcelTemplate;
  className?: string;
  disabled?: boolean;
  onError?: (message: string) => void;
}> = ({ template, className = '', disabled = false, onError }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);

  const download = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await downloadTemplate(template);
    } catch (cause) {
      const message = cause instanceof Error && cause.message ? cause.message : TEMPLATE_DOWNLOAD_ERROR;
      if (onError) onError(message); else setError(message);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return <>
    <Button variant="secondary" className={className} disabled={disabled || busy} onClick={() => void download()}>
      <Download size={18} aria-hidden="true" />Excel Şablonu İndir
    </Button>
    {error && <span role="alert" className="text-sm text-red-700">{error}</span>}
  </>;
};
