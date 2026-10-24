(function () {
  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Theme: follows the system until you pick one
  var themeBtn = document.querySelector('.theme');
  var sysLight = window.matchMedia('(prefers-color-scheme: light)');
  function current() { return root.dataset.theme || (sysLight.matches ? 'light' : 'dark'); }
  function label() {
    var next = current() === 'dark' ? 'Light' : 'Dark';
    themeBtn.textContent = next;
    themeBtn.setAttribute('aria-label', 'Switch to ' + next.toLowerCase() + ' theme');
    document.querySelector('meta[name=theme-color]').content = current() === 'dark' ? '#1C1B19' : '#FBFAF8';
  }
  themeBtn.addEventListener('click', function () {
    root.dataset.theme = current() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('sk-theme', root.dataset.theme); } catch (e) {}
    label();
  });
  sysLight.addEventListener && sysLight.addEventListener('change', label);
  label();

  // Copy
  var note = document.querySelector('.toast-copied');
  function fallbackCopy(text) {
    var t = document.createElement('textarea');
    t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(t);
  }
  document.querySelectorAll('.copy').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.dataset.copy;
      var p = navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject();
      p.catch(function () { fallbackCopy(text); }).then(function () {
        btn.textContent = 'Copied'; btn.classList.add('done');
        note.textContent = 'Copied. Paste it into Claude Code.'; note.classList.add('show');
        clearTimeout(btn._t);
        btn._t = setTimeout(function () { btn.textContent = 'Copy'; btn.classList.remove('done'); note.classList.remove('show'); }, 2200);
      });
    });
  });

  // Gauges and segments fill when they scroll into view
  var visuals = document.querySelectorAll('.fix-visual');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in-view');
        var segs = e.target.querySelectorAll('.segs i');
        segs.forEach(function (s, i) { s.style.transitionDelay = (i * 60) + 'ms'; });
        io.unobserve(e.target);
      });
    }, { threshold: 0.4 });
    visuals.forEach(function (v) { io.observe(v); });
  } else {
    visuals.forEach(function (v) { v.classList.add('in-view'); });
  }

  // Video: fill data-video-id in index.html and the player turns on
  var player = document.querySelector('.player');
  var vid = player && player.dataset.videoId;
  if (vid) {
    player.dataset.ready = '';
    player.querySelector('.play-text').textContent = 'Play the walkthrough';
    player.querySelector('.play').addEventListener('click', function () {
      player.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(vid) + '?autoplay=1&rel=0" title="Swiss Knife walkthrough" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
    });
  }

  // Hero: Claude works, then the strip turns red when it needs you
  var strip = document.querySelector('.strip.live');
  var heroImg = document.querySelector('.hero-mascot');
  var stripImg = strip.querySelector('img');
  var lead = strip.querySelector('.strip-lead');
  var time = strip.querySelector('.strip-time');
  var l2 = strip.querySelector('.strip-l2');
  var work = ['thinking', 'reading', 'writing', 'testing'];
  ['thinking', 'reading', 'writing', 'testing', 'waiting-for-you'].forEach(function (m) { new Image().src = 'assets/' + m + '.svg'; });
  function mood(m) { heroImg.src = stripImg.src = 'assets/' + m + '.svg'; }
  function needYou() {
    strip.dataset.state = 'need';
    lead.textContent = '● Claude needs you';
    l2.textContent = 'It wants your OK to go on. Answer in the chat.';
    mood('waiting-for-you');
  }
  if (reduce) { needYou(); time.textContent = '· waiting 0:10'; return; }

  var t = 0, phase = 'work', w = 0, sec = 42;
  setInterval(function () {
    t++;
    if (phase === 'work') {
      sec++; time.textContent = '· 0:' + String(sec).padStart(2, '0');
      if (t % 2 === 0) mood(work[(++w) % work.length]);
      if (t >= 7) { phase = 'need'; t = 0; needYou(); time.textContent = '· waiting 0:00'; }
    } else {
      time.textContent = '· waiting 0:' + String(t).padStart(2, '0');
      if (t >= 10) {
        phase = 'work'; t = 0; sec = 42;
        strip.dataset.state = 'work';
        lead.textContent = '● Working';
        l2.textContent = 'Writing the About us page.';
        mood('writing');
      }
    }
  }, 1000);
})();
