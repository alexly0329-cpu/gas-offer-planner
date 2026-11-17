// Apply the saved theme before first paint; storage can be disabled in private browsers.
(() => {
  let saved;
  try { saved = localStorage.getItem('westgas-theme'); } catch {}
  document.documentElement.dataset.theme = saved === 'dark' ? 'dark' : 'light';
})();

