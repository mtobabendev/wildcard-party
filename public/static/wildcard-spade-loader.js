/* WildCard DEV Spade Loader v1.0 — dependency-free, same code across WildCard apps.
   API: WildCardLoader.show({ label, progress? }) -> token
        WildCardLoader.update(token, progress, label?) ; .hide(token) ; .track(promise, options).
   Percentages are displayed only when supplied by the calling app. */
(function () {
  'use strict';

  if (window.WildCardLoader) return;
  var sourceScript = document.currentScript;
  var autostart = !!(sourceScript && sourceScript.hasAttribute('data-wcd-autostart'));
  var jobs = new Map();
  var nextId = 0;
  var openTimer = null;
  var shell = null;
  var fields = null;
  var previousRootBusy = null;
  var rootBusySet = false;

  var css = [
    '.wcdl[hidden]{display:none!important}',
    '.wcdl,.wcdl *{box-sizing:border-box}',
    '.wcdl{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:16px;',
    'background:rgba(7,3,18,.86);backdrop-filter:blur(13px);-webkit-backdrop-filter:blur(13px);',
    'color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}',
    '.wcdl__card{position:relative;isolation:isolate;width:min(410px,100%);overflow:hidden;text-align:center;',
    'padding:35px 24px 29px;border:1px solid #db71dbb8;border-radius:24px;',
    'background:radial-gradient(ellipse at 50% 5%,#63235a70,transparent 60%),linear-gradient(155deg,#21102d,#0c0818 75%);',
    'box-shadow:0 22px 75px #000c,0 0 40px #ec2ba735,inset 0 0 44px #f35bc017}',
    '.wcdl__card:before{content:"";position:absolute;inset:0;pointer-events:none;border-radius:inherit;',
    'box-shadow:inset 0 0 0 1px #ee8feb36,inset 0 0 44px #e520a10d}',
    '.wcdl__close{position:absolute;top:12px;right:13px;width:35px;height:35px;',
    'display:grid;place-items:center;border:1px solid #ffb1ec6b;border-radius:50%;',
    'background:#361632ba;color:#fff;font:20px/1 system-ui;cursor:pointer}',
    '.wcdl__close:focus-visible{outline:3px solid #fff;outline-offset:3px}',
    '.wcdl__brand{margin:0 0 7px;font-size:clamp(15px,3.5vw,20px);font-weight:900;letter-spacing:.13em}',
    '.wcdl__brand b{color:#ff80d0}',
    '.wcdl__script{margin:0 0 15px;color:#ffc6ec;font:italic 25px Georgia,serif;',
    'text-shadow:0 0 8px #fc41c8,0 0 22px #e218a2}',
    '.wcdl__spades{display:flex;justify-content:center;align-items:center;gap:12px;',
    'margin:9px auto 18px;user-select:none}',
    '.wcdl__spade{font:normal 39px/1 Georgia,serif;color:#6d327e;opacity:.64;',
    'text-shadow:0 0 9px #85265b;transition:color .18s,opacity .18s,filter .18s}',
    '.wcdl__spade:before{content:"♠"}',
    '.wcdl--busy .wcdl__spade{animation:wcdl-pulse 1.65s ease-in-out infinite}',
    '.wcdl--busy .wcdl__spade:nth-child(2){animation-delay:.17s}',
    '.wcdl--busy .wcdl__spade:nth-child(3){animation-delay:.34s}',
    '.wcdl--busy .wcdl__spade:nth-child(4){animation-delay:.51s}',
    '.wcdl--busy .wcdl__spade:nth-child(5){animation-delay:.68s}',
    '.wcdl__spade[data-filled="true"]{color:#ff83db;opacity:1;',
    'filter:drop-shadow(0 0 5px #fa65d0);text-shadow:0 0 10px #f54abb,0 0 22px #d02cbe}',
    '.wcdl__track{height:12px;overflow:hidden;border:1px solid #c668b1a8;',
    'background:#180b24;border-radius:999px;box-shadow:inset 0 2px 8px #040208}',
    '.wcdl__fill{height:100%;width:0;border-radius:inherit;',
    'background:linear-gradient(90deg,#b943bb,#ff68c6 60%,#ffcfed);',
    'box-shadow:0 0 12px #ff59c9,inset 0 1px 2px #fff7;transition:width .2s ease}',
    '.wcdl--busy .wcdl__fill{width:34%;animation:wcdl-bar 1.65s ease-in-out infinite}',
    '.wcdl__bottom{margin:15px 0 0;display:flex;align-items:center;justify-content:center;',
    'gap:7px;min-height:22px;color:#fff3fc;font-size:13px;font-weight:600;line-height:1.45}',
    '.wcdl__percent{color:#ff9fdf;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.wcdl__note{margin:10px 0 0;color:#caa5d3;font-size:11px}',
    '@keyframes wcdl-pulse{0%,65%,100%{color:#723180;opacity:.55;filter:none}',
    '28%{color:#ffe4fa;opacity:1;filter:drop-shadow(0 0 11px #ff3aca)}}',
    '@keyframes wcdl-bar{0%{transform:translateX(-100%)}50%{transform:translateX(120%)}',
    '100%{transform:translateX(310%)}}',
    '@media(prefers-reduced-motion:reduce){',
    '.wcdl__spade,.wcdl__fill{animation:none!important;transition:none!important}',
    '.wcdl--busy .wcdl__spade:nth-child(3){color:#ffabdf;opacity:1}',
    '.wcdl--busy .wcdl__fill{width:33%;transform:none!important}}',
    '@media(max-width:390px){.wcdl__card{padding:32px 17px 25px}',
    '.wcdl__spades{gap:8px}.wcdl__spade{font-size:33px}}'
  ].join('');

  function makeShell() {
    if (shell || !document.body) return;
    if (!document.getElementById('wcd-spade-loader-style')) {
      var style = document.createElement('style');
      style.id = 'wcd-spade-loader-style';
      style.textContent = css;
      document.head.appendChild(style);
    }
    shell = document.createElement('section');
    shell.className = 'wcdl';
    shell.setAttribute('role', 'status');
    shell.setAttribute('aria-label', 'WildCard DEV loading');
    shell.setAttribute('aria-live', 'polite');
    shell.hidden = true;
    shell.innerHTML =
      '<div class="wcdl__card">' +
      '<button class="wcdl__close" type="button" aria-label="Dismiss loading screen" title="Dismiss">×</button>' +
      '<div class="wcdl__brand">♠ WILDCARD <b>DEV</b></div>' +
      '<div class="wcdl__script">The Next Hand Awaits</div>' +
      '<div class="wcdl__spades" aria-hidden="true"><i class="wcdl__spade"></i>' +
      '<i class="wcdl__spade"></i><i class="wcdl__spade"></i>' +
      '<i class="wcdl__spade"></i><i class="wcdl__spade"></i></div>' +
      '<div class="wcdl__track" role="progressbar" aria-label="Loading progress" aria-valuemin="0" aria-valuemax="100">' +
      '<div class="wcdl__fill"></div></div>' +
      '<p class="wcdl__bottom"><span class="wcdl__label"></span> ' +
      '<span class="wcdl__percent"></span></p>' +
      '<p class="wcdl__note">♠ WildCard DEV · Your next hand is loading</p></div>';
    document.body.appendChild(shell);
    fields = {
      spades: shell.querySelectorAll('.wcdl__spade'),
      track: shell.querySelector('.wcdl__track'),
      fill: shell.querySelector('.wcdl__fill'),
      label: shell.querySelector('.wcdl__label'),
      percent: shell.querySelector('.wcdl__percent')
    };
    shell.querySelector('.wcdl__close').addEventListener('click', function () { hide(); });
  }

  function updateRootBusy(value) {
    var root = document.getElementById('root');
    if (!root) return;
    if (value && !rootBusySet) {
      previousRootBusy = root.getAttribute('aria-busy');
      root.setAttribute('aria-busy', 'true');
      rootBusySet = true;
    } else if (!value && rootBusySet) {
      if (previousRootBusy === null) root.removeAttribute('aria-busy');
      else root.setAttribute('aria-busy', previousRootBusy);
      rootBusySet = false;
      previousRootBusy = null;
    }
  }

  function render() {
    if (openTimer !== null) {
      window.clearTimeout(openTimer);
      openTimer = null;
    }
    if (!jobs.size) {
      if (shell) shell.hidden = true;
      updateRootBusy(false);
      return;
    }
    makeShell();
    if (!shell) return;
    var latest = Array.from(jobs.values()).pop();
    var progress = latest.progress;
    var bounded = typeof progress === 'number' && Number.isFinite(progress);
    shell.hidden = false;
    shell.classList.toggle('wcdl--busy', !bounded);
    fields.label.textContent = latest.label || 'Shuffling your WildCard DEV experience…';
    fields.percent.textContent = bounded ? String(Math.round(progress)) + '%' : '';
    fields.fill.style.width = bounded ? progress + '%' : '';
    if (bounded) fields.track.setAttribute('aria-valuenow', String(Math.round(progress)));
    else fields.track.removeAttribute('aria-valuenow');
    for (var i = 0; i < fields.spades.length; i++) {
      fields.spades[i].setAttribute('data-filled',
        bounded && progress >= (i + 1) * 20 ? 'true' : 'false');
    }
    updateRootBusy(true);
  }

  function queueRender() {
    if (!jobs.size) return render();
    if (shell && !shell.hidden) return render();
    if (openTimer !== null) return;
    openTimer = window.setTimeout(function () {
      openTimer = null;
      render();
    }, 180);
  }

  function show(options) {
    options = typeof options === 'string' ? { label: options } : options || {};
    var token = ++nextId;
    var progress = Number.isFinite(options.progress)
      ? Math.max(0, Math.min(100, options.progress)) : null;
    jobs.set(token, {
      progress: progress,
      label: typeof options.label === 'string' ? options.label.slice(0, 140) : ''
    });
    queueRender();
    return token;
  }

  function update(token, progress, label) {
    if (!jobs.has(token)) return false;
    var current = jobs.get(token);
    current.progress = Number.isFinite(progress)
      ? Math.max(0, Math.min(100, progress)) : null;
    if (typeof label === 'string') current.label = label.slice(0, 140);
    queueRender();
    return true;
  }

  function hide(token) {
    if (token === undefined || token === null) jobs.clear();
    else jobs.delete(token);
    queueRender();
  }

  function track(promise, options) {
    var token = show(options);
    return Promise.resolve(promise).then(
      function (result) { hide(token); return result; },
      function (error) { hide(token); throw error; }
    );
  }

  window.WildCardLoader = Object.freeze({
    show: show, begin: show, update: update, hide: hide, end: hide, track: track,
    isActive: function () { return jobs.size > 0; }
  });

  if (autostart) {
    var start = function () {
      var root = document.getElementById('root');
      if (!root || root.children.length) return;
      var token = show({ label: 'Shuffling your WildCard DEV experience…' });
      var observer = new MutationObserver(function () {
        if (!root.children.length) return;
        observer.disconnect();
        window.requestAnimationFrame(function () { hide(token); });
      });
      observer.observe(root, { childList: true });
      window.addEventListener('pagehide', function () {
        observer.disconnect();
        hide(token);
      }, { once: true });
      // A failed JS module should not leave an unexplainable forever-spinner.
      window.setTimeout(function () {
        if (jobs.has(token)) {
          jobs.get(token).label = 'This is taking longer than expected. You can dismiss the loader.';
          queueRender();
        }
      }, 12000);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
}());
