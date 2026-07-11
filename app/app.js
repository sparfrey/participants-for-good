/* Shared utilities: heart bursts, toasts, and feel-good moments. */

const PFG = (() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const HEARTS = ['💚', '💛', '💙', '🧡'];

  /* Little hearts pop up from an element — used on actions that do good. */
  const hearts = (el, count) => {
    if (reduced || !el) return;
    const r = el.getBoundingClientRect();
    const n = count || 6;
    for (let i = 0; i < n; i++) {
      const h = document.createElement('span');
      h.className = 'heart-pop';
      h.textContent = HEARTS[Math.floor(Math.random() * HEARTS.length)];
      h.style.left = (r.left + r.width / 2 + (Math.random() * 44 - 22)) + 'px';
      h.style.top = (r.top + 4) + 'px';
      h.style.setProperty('--dx', (Math.random() * 48 - 24) + 'px');
      h.style.animationDelay = (Math.random() * 0.18) + 's';
      document.body.appendChild(h);
      setTimeout(() => h.remove(), 1400);
    }
  };

  /* One toast element, reused. */
  let toastEl = null, toastTimer = null;
  const toast = (msg) => {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
  };

  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

  /* Declarative sugar: any element with data-hearts pops hearts on click,
     and data-toast shows its message. */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-hearts], [data-toast]');
    if (!el) return;
    if (el.hasAttribute('data-hearts')) hearts(el);
    if (el.dataset.toast) toast(el.dataset.toast);
  });

  return { hearts, toast, money, reduced };
})();
