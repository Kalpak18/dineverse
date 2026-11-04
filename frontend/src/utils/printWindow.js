// Prints a receipt, KOT or serving slip from the current page: the document
// goes into a print-only container and the browser's print dialog opens —
// no pop-up window. On screen the container stays hidden and the app is
// untouched; while printing, only the document is shown.
// The HTML is a full document whose <style> applies only to the printout.
// It must not rely on scripts: the site's CSP blocks inline JS.
const ROOT_ID = 'dv-print-root';

export function printDocument(html) {
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
