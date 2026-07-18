/* Server-rendered HTML helpers. All user data must pass through esc(). */

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const money = (cents) => '$' + (cents / 100).toLocaleString('en-US', {
  minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2
});

export function layout({ title, body, user = null, flash = '' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} · Participants for Good</title>
<link rel="icon" type="image/svg+xml" href="/logo.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/app.css">
<script src="/app.js" defer></script>
</head>
<body>

<div class="appbar">
  <div class="wrap appbar-in">
    <a class="logo" href="/"><img src="/logo.svg" alt="">Participants for Good</a>
    <nav>
      ${user
        ? `<a href="/dashboard">Dashboard</a>
           <form method="post" action="/signout" class="inlineform"><button class="btn btn-ghost btn-sm">Sign out</button></form>`
        : `<a class="btn btn-blue btn-sm" href="/signin">Sign in</a>`}
    </nav>
  </div>
</div>

<main class="wrap page">
${flash ? `<div class="flash goodnote">${esc(flash)}</div>` : ''}
${body}
</main>

<footer class="platform-foot">
  <div class="wrap foot">
    <p>© 2026 Participants for Good · Research that gives back</p>
    <div class="foot-links">
      <a href="mailto:hello@participantsforgood.org">hello@participantsforgood.org</a>
      <a href="https://participantsforgood.org">About</a>
    </div>
  </div>
</footer>

</body>
</html>`;
}
