// Loaded before the game. If the game has not reached its menu after a while, or one of its files
// fails to load, show what it is doing and any errors instead of a blank or frozen page. Styled through
// the style object (no inline script or style attribute, so it also works under a strict
// Content-Security-Policy) because the game's stylesheet may be one of the files that failed.
(function () {
  var errs = [];
  var soon = 0;
  function note(m) {
    if (m && errs.length < 6) errs.push(String(m).slice(0, 300));
  }
  function css(el, s) {
    for (var k in s) el.style[k] = s[k];
    return el;
  }
  window.addEventListener('error', function (e) {
    var t = e.target;
    var src = t && (t.src || t.href);
    note(e.message || (src ? 'failed to load ' + src : 'load error'));
    // a game file is missing: say so right away rather than after the long wait
    if (src && !soon) soon = setTimeout(check, 1500);
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    note(e.reason && (e.reason.message || e.reason));
  });
  function check() {
    if (window.__bfReady || !document.body) return;
    var box = document.getElementById('bf-stuck');
    if (!box) {
      box = css(document.createElement('div'), {
        position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', zIndex: '100',
        width: 'min(560px, 92vw)', boxSizing: 'border-box', padding: '14px 16px', background: '#11151b',
        border: '1px solid rgba(255,77,77,0.5)', color: '#e9edf2', font: '14px system-ui, sans-serif', textAlign: 'center',
      });
      box.id = 'bf-stuck';
      document.body.appendChild(box);
    }
    box.textContent = '';
    var t = css(document.createElement('div'), { fontWeight: '700', marginBottom: '6px' });
    t.textContent = window.__bfStarted ? 'Still loading…' : 'BlockForge could not start.';
    var d = css(document.createElement('div'), { color: '#98a3b1', fontSize: '12px', wordBreak: 'break-word', marginBottom: '10px' });
    d.textContent = 'Step: ' + (window.__bfStep || 'downloading the game') + (errs.length ? ' — ' + errs.join(' | ') : '');
    var b = css(document.createElement('button'), {
      font: 'inherit', fontWeight: '700', padding: '6px 18px', background: '#f2a93b', color: '#1a1205', border: '0', cursor: 'pointer',
    });
    b.textContent = 'Reload';
    b.onclick = function () {
      location.reload();
    };
    box.appendChild(t);
    box.appendChild(d);
    box.appendChild(b);
  }
  setTimeout(check, 25000);
  setTimeout(check, 60000);
})();
