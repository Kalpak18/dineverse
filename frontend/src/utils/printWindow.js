import toast from 'react-hot-toast';

// Opens a print pop-up for receipts, KOTs and serving slips.
// The HTML must not contain <script> or inline on* handlers: the site's CSP
// blocks inline scripts (and pop-ups inherit it), so printing and the PRINT
// button are wired from here instead.
//   autoPrint   — open the print dialog once the document has rendered
//   printButton — id of a button in the HTML that should print
// Returns false (and tells the user) if the browser blocked the pop-up.
export function openPrintWindow(html, { features = 'width=400,height=600', autoPrint = false, printButton = null } = {}) {
  const w = window.open('', '_blank', features);
  if (!w) {
    toast.error('Pop-up blocked — allow pop-ups for this site to print');
    return false;
  }
  w.document.write(html);
  w.document.close();

  const print = () => {
    w.focus();
    w.onafterprint = () => w.close();
    w.print();
  };
  if (printButton) w.document.getElementById(printButton)?.addEventListener('click', print);
  if (autoPrint) {
    // Give fonts/images a moment to lay out before the dialog snapshots the page
    if (w.document.readyState === 'complete') setTimeout(print, 300);
    else w.addEventListener('load', () => setTimeout(print, 300));
  } else {
    w.focus();
  }
  return true;
}
