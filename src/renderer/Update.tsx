import { Download, X } from 'lucide-react';
import type { Update } from '../shared/types';
import { Markdown } from './Markdown';
import { api } from './lib';

/** A newer release was found on GitHub at start. `onClose(true)` = don't offer this version again. */
export function UpdateNotice({ update, onClose }: { update: Update; onClose: (skip?: boolean) => void }) {
  return (
    <div className="modal" onClick={() => onClose()}>
      <section className="dialog" role="dialog" aria-label="Update available" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Cutroom {update.version} is available</h2>
          <span className="spacer" />
          <button className="ghost round" title="Later" onClick={() => onClose()}><X size={16} /></button>
        </header>
        <p className="description">You are using {update.current}.</p>
        {update.notes && (
          <div className="body notes">
            <strong>What’s new</strong>
            <Markdown text={update.notes} />
          </div>
        )}
        <footer>
          <button className="ghost" onClick={() => onClose(true)}>Skip this version</button>
          <span className="spacer" />
          <button onClick={() => onClose()}>Later</button>
          <button className="primary" onClick={() => (void api.downloadUpdate(), onClose())}><Download size={16} /> Download</button>
        </footer>
      </section>
    </div>
  );
}
