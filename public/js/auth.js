/* WorldFront.News auth + PWA helpers */
window.WF = WF || {};

// Autosign-in guard used by account/admin views
function isSignedIn() {
  return !!WF.state.token;
}
window.isSignedIn = isSignedIn;

// PWA install banner
(function installUI() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    const prompt = e;
    window.WF._deferredPrompt = prompt;

    // Show a lightweight install toast the first time
    let dismissed = localStorage.getItem('wf-install-dismiss');
    if (dismissed === '1') return;
    setTimeout(() => {
      WF.toast('Install WorldFront.News to your phone?');
    }, 4000);
    window.addEventListener('click', function installer() {
      const d = window.WF._deferredPrompt;
      if (d) {
        d.prompt();
        d.userChoice.then(() => { window.WF._deferredPrompt = null; localStorage.setItem('wf-install-dismiss', '1'); });
        window.removeEventListener('click', installer);
      }
    });
  });
  window.addEventListener('appinstalled', () => {
    localStorage.setItem('wf-install-dismiss', '1');
    WF.toast('WorldFront.News installed! ✓');
  });
})();

// Keep search panel Escape key handling
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.getElementById('searchPanel').classList.remove('open');
    document.getElementById('locationPanel').classList.remove('open');
  }
});
