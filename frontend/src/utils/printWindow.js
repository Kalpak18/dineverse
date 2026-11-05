// Bills, KOTs and serving slips are shown in an in-app preview first
// (components/PrintPreview.jsx) with Print / WhatsApp / Share / Close — never
// straight into the phone's print screen, which feels like leaving the app.
// The HTML is a full document whose <style> applies only to the printout. It
// must not rely on scripts: the site's CSP blocks inline JS.
const ROOT_ID = 'dv-print-root';
export const PRINT_EVENT = 'dv:print-preview';

let previewMounted = false;
export const setPreviewMounted = (mounted) => { previewMounted = mounted; };

// share: { text, phone } — a plain-text copy for WhatsApp / the share sheet
export function printDocument(html, { title = 'Print', share = null } = {}) {
  if (!previewMounted) return printNow(html); // no preview host (shouldn't happen)
  window.dispatchEvent(new CustomEvent(PRINT_EVENT, { detail: { html, title, share } }));
}

// Opens the browser's print dialog for the document, from this page: it goes
// into a print-only container (hidden on screen; only it is shown on paper).
export function printNow(html) {
  document.getElementById(ROOT_ID)?.remove();
  document.getElementById(`${ROOT_ID}-style`)?.remove();

  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script').forEach((el) => el.remove());
  const css = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n');

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML = doc.body.innerHTML;

  const style = document.createElement('style');
  style.id = `${ROOT_ID}-style`;
  style.textContent = `#${ROOT_ID} { display: none; }
@media print {
  body > *:not(#${ROOT_ID}) { display: none !important; }
  #${ROOT_ID} { display: block; }
${css}
}`;
  document.body.append(style, root);

  const cleanup = () => {
    root.remove();
    style.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);

  // Print right away when nothing needs loading (still inside the tap, which
  // some phone browsers require); otherwise give a logo a moment to load
  const pending = [...root.querySelectorAll('img')].filter((img) => !img.complete);
  if (!pending.length) {
    window.print();
    return;
  }
  const loaded = Promise.all(pending.map((img) => new Promise((done) => {
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
  })));
  Promise.race([loaded, new Promise((done) => setTimeout(done, 1500))]).then(() => window.print());
}
