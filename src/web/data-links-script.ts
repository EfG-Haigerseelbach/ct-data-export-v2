export const dataLinksScript = String.raw`'use strict';
(() => {
 function reveal(hash) {
  if (!/^#(?:group|person)-[1-9]\d*$/.test(hash)) return;
  const target = document.getElementById(hash.slice(1));
  if (!target || target.tagName !== 'DETAILS') return;
  target.open = true;
  const summary = target.querySelector('summary');
  if (summary) summary.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'start' });
 }
 document.addEventListener('click', (event) => {
  const link = event.target.closest?.('a[data-record-link]');
  if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  // Vor der normalen Fragmentnavigation öffnen, auch wenn derselbe Link erneut angeklickt wird.
  reveal(link.getAttribute('href'));
 });
 window.addEventListener('hashchange', () => reveal(window.location.hash));
 reveal(window.location.hash);
})();`;
