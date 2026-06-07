// Service-worker registration + update banner — externalized from an inline
// <script> for CSP script-src 'self'. Loaded near the end of <body>.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').then(function (registration) {
      // Detect a newly-installed worker waiting to take over and prompt the user
      // to reload, so they don't keep running stale cached code.
      function trackInstalling(worker) {
        if (!worker) return;
        worker.addEventListener('statechange', function () {
          // A new worker reaching "installed" while one already controls the page
          // means an update is ready (first install has no controller, so skip it).
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner(registration);
          }
        });
      }
      if (registration.waiting && navigator.serviceWorker.controller) showUpdateBanner(registration);
      trackInstalling(registration.installing);
      registration.addEventListener('updatefound', function () {
        trackInstalling(registration.installing);
      });
    }).catch(function (err) {
      console.warn('Service worker registration skipped:', err);
    });

    // Reload once a NEW worker takes control (after SKIP_WAITING). Guard on a
    // controller already existing at load: on a first visit the SW claims an
    // uncontrolled page, which ALSO fires controllerchange — reloading then
    // would bounce every first visit (and breaks anything mid-run, e.g. Game
    // Review). Only auto-reload when an existing controller is replaced.
    var hadController = !!navigator.serviceWorker.controller;
    var refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController || refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}

// Small, non-blocking "new version available" banner. Tapping Reload tells the
// waiting worker to activate (sw.js handles {type:'SKIP_WAITING'}), then the
// controllerchange listener above reloads the page.
function showUpdateBanner(registration) {
  if (document.getElementById('sw-update-banner')) return;
  var bar = document.createElement('div');
  bar.id = 'sw-update-banner';
  bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(72px + env(safe-area-inset-bottom));z-index:1300;display:flex;align-items:center;gap:12px;background:#17223b;border:1px solid #f5c451;color:#e8eefc;padding:10px 14px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.4);font-size:14px;max-width:90%;font-family:Inter,-apple-system,sans-serif;';
  var msg = document.createElement('span');
  msg.textContent = 'A new version is available.';
  var btn = document.createElement('button');
  btn.textContent = 'Reload';
  btn.style.cssText = 'background:#f5c451;color:#1a1300;border:none;border-radius:8px;padding:6px 12px;font-weight:700;cursor:pointer;font-family:inherit;';
  btn.addEventListener('click', function () {
    var w = registration.waiting;
    if (w) w.postMessage({ type: 'SKIP_WAITING' });
    btn.disabled = true;
    btn.textContent = 'Updating…';
  });
  bar.appendChild(msg);
  bar.appendChild(btn);
  document.body.appendChild(bar);
}
