// Loaded before the game. If the game has not reached its menu after a while, show what it is doing and
// any errors instead of a blank or frozen page. No inline script or style, so it also works under a
// strict Content-Security-Policy.
(function () {
  var errs = [];
  function note(m) {
    if (m && errs.length < 6) errs.push(String(m).slice(0, 300));
  }
  window.addEventListener('error', function (e) {
    var t = e.target;
    var src = t && (t.src || t.href);
    note(e.message || (src ? 'failed to load ' + src : 'load error'));
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    note(e.reason && (e.reason.message || e.reason));
  });
  function check() {
    if (window.__bfReady || !document.body) return;
    var box = document.getElementById('bf-stuck');
    if (!box) {
      box = document.createElement('div');
      box.id = 'bf-stuck';
      box.className = 'bf-stuck';
      document.body.appendChild(box);
    }
    box.textContent = '';
    var t = document.createElement('div');
    t.className = 'bf-stuck-t';
    t.textContent = window.__bfStarted ? 'Still loading…' : 'BlockForge could not start.';
    var d = document.createElement('div');
    d.className = 'bf-stuck-d';
    d.textContent = 'Step: ' + (window.__bfStep || 'downloading the game') + (errs.length ? ' — ' + errs.join(' | ') : '');
    var b = document.createElement('button');
    b.className = 'bf-stuck-b';
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
