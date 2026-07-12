document.addEventListener('DOMContentLoaded', () => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const viewportH = () => Math.max(window.innerHeight, document.documentElement.clientHeight);
  const envSane = viewportH() > 0;

  /* Scroll reveals */
  const els = [...document.querySelectorAll('.section-head, .card, .door, .step, .commitment, .dash, .feature-copy, .callout, .signup-box, .statement .big')];
  els.forEach(el => {
    el.classList.add('reveal');
    const idx = [...el.parentElement.children].indexOf(el);
    el.style.transitionDelay = Math.min(idx * 70, 280) + 'ms';
  });

  /* Count-up numbers (leave server-rendered text alone if env can't animate) */
  const counts = envSane ? [...document.querySelectorAll('.count')] : [];
  const animateCount = (el) => {
    const target = parseFloat(el.dataset.count);
    const prefix = el.dataset.prefix || '';
    const dur = 1200;
    const t0 = performance.now();
    let done = false;
    const step = (t) => {
      const p = Math.min((t - t0) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = prefix + Math.round(target * eased).toLocaleString('en-US');
      if (p < 1) requestAnimationFrame(step); else done = true;
    };
    requestAnimationFrame(step);
    setTimeout(() => { if (!done) el.textContent = prefix + target.toLocaleString('en-US'); }, dur + 400);
  };

  /* Progress bar */
  let bar = null;
  if (envSane) {
    bar = document.createElement('div');
    bar.className = 'progress';
    document.body.appendChild(bar);
  }

  let ticking = false;
  const check = () => {
    ticking = false;
    const vh = viewportH();
    const limit = vh > 0 ? vh * 0.92 : Infinity;
    els.forEach(el => {
      if (!el.classList.contains('in') && el.getBoundingClientRect().top < limit) {
        el.classList.add('in');
      }
    });
    for (let i = counts.length - 1; i >= 0; i--) {
      if (counts[i].getBoundingClientRect().top < limit) {
        animateCount(counts[i]);
        counts.splice(i, 1);
      }
    }
    if (bar) {
      const total = document.documentElement.scrollHeight - vh;
      bar.style.width = (total > 0 ? (window.scrollY / total) * 100 : 0) + '%';
    }
  };
  const onScroll = () => {
    if (!ticking) { ticking = true; requestAnimationFrame(check); }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  check();

  /* Typewriter headline */
  const rt = document.querySelector('.rotate-text');
  if (rt && rt.dataset.phrases) {
    const phrases = JSON.parse(rt.dataset.phrases);
    let pi = 0;
    /* Reserve the tallest phrase's height so typing never shifts layout */
    const em = rt.closest('em');
    const lockHeight = () => {
      const prev = rt.textContent;
      em.style.minHeight = '';
      let max = 0;
      phrases.forEach(p => { rt.textContent = p; max = Math.max(max, em.offsetHeight); });
      rt.textContent = prev;
      em.style.minHeight = max + 'px';
    };
    lockHeight();
    window.addEventListener('resize', lockHeight, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(lockHeight);
    const type = (text, i, cb) => {
      rt.textContent = text.slice(0, i);
      if (i < text.length) setTimeout(() => type(text, i + 1, cb), 55);
      else setTimeout(cb, 2400);
    };
    const erase = (cb) => {
      const cur = rt.textContent;
      if (cur.length) { rt.textContent = cur.slice(0, -1); setTimeout(() => erase(cb), 28); }
      else cb();
    };
    const loop = () => {
      erase(() => {
        pi = (pi + 1) % phrases.length;
        type(phrases[pi], 0, loop);
      });
    };
    setTimeout(loop, 2800);
  }

  /* Hero parallax: the collage and the little shapes drift with the cursor */
  const hero = document.querySelector('.hero-split');
  const visual = document.querySelector('.hero-visual');
  if (hero && visual) {
    const doodads = [...hero.querySelectorAll('.doodad[data-depth]')];
    hero.addEventListener('mousemove', (e) => {
      const r = hero.getBoundingClientRect();
      const dx = (e.clientX - r.left) / r.width - 0.5;
      const dy = (e.clientY - r.top) / r.height - 0.5;
      visual.style.transform = 'translate(' + (dx * 16) + 'px, ' + (dy * 12) + 'px)';
      doodads.forEach(d => {
        const depth = +d.dataset.depth || 16;
        d.style.transform = 'translate(' + (dx * depth) + 'px, ' + (dy * depth * 0.8) + 'px)';
      });
    });
    hero.addEventListener('mouseleave', () => {
      visual.style.transform = '';
      doodads.forEach(d => { d.style.transform = ''; });
    });
  }
});
