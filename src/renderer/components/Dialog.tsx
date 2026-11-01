import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Dialog({ title, children, footer, onClose, wide = false }: {
  title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return <dialog ref={ref} className={`dialog${wide ? ' dialog-wide' : ''}`} aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className="dialog-header"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" aria-label={`Close ${title}`} onClick={onClose}><X size={16} /></button></header>
    <div className="dialog-body">{children}</div>
    {footer && <footer className="dialog-footer">{footer}</footer>}
  </dialog>;
}
