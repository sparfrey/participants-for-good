import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, q, QUARTER_CAP } from './db.js';
import {
  DEV, requestMagicLink, deliverMagicLink, consumeMagicLink,
  sessionCookie, attachUser, requireUser
} from './auth.js';
import { layout, esc, money } from './html.js';
import { researcher } from './researcher.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(root, 'public')));
app.use(attachUser);

const isEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
const flashOf = (req) => typeof req.query.m === 'string' ? req.query.m.slice(0, 200) : '';

/* ---------- Home ---------- */

app.get('/', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.send(layout({
    title: 'Welcome',
    body: `
      <div class="auth-hero">
        <p class="eyebrow">Research that gives back</p>
        <h1 class="auth-title">Get paid for your voice. Fund a cause you love.</h1>
        <p class="auth-sub">Join research studies that pay you for every session and send money
        to the charity or nonprofit you choose. Free to join, always optional, always paid.</p>
        <div class="auth-ctas">
          <a class="btn btn-blue" href="/signin">Join or sign in</a>
          <a class="btn btn-ghost" href="https://participantsforgood.org">How it works</a>
        </div>
      </div>
      <div class="grid3 auth-points">
        <div class="card"><h2>💵 Paid fairly</h2><p class="hint">Market-rate incentives for every completed session. No minimums, no expiry.</p></div>
        <div class="card"><h2>💚 Your cause funded</h2><p class="hint">Every session sends a contribution to the nonprofit you pick, on top of your pay.</p></div>
        <div class="card"><h2>✋ Always your choice</h2><p class="hint">Every invite is optional, every study is consent-first, and we cap how often you're asked.</p></div>
      </div>`
  }));
});

/* ---------- Sign in ---------- */

app.get('/signin', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.send(layout({
    title: 'Sign in',
    flash: flashOf(req),
    body: `
      <div class="auth-box card">
        <h1 class="auth-title-sm">Join or sign in</h1>
        <p class="hint">No passwords. We email you a one-time sign-in link.</p>
        <form method="post" action="/signin" class="stackform">
          <label class="field"><span>Email</span>
            <input type="email" name="email" required placeholder="you@example.com" autofocus>
          </label>
          <button class="btn btn-blue" type="submit">Email me a sign-in link</button>
        </form>
        <p class="finehint">First time? The same link creates your account. By continuing you agree to the
        <a href="https://participantsforgood.org/app/terms.html#participants">participant terms</a>.</p>
      </div>`
  }));
});

app.post('/signin', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!isEmail(email)) return res.redirect('/signin?m=' + encodeURIComponent('That email doesn’t look right. Try again?'));

  const { token } = requestMagicLink(email);
  let devUrl = null;
  try {
    const out = await deliverMagicLink(email, token);
    devUrl = out.url;
  } catch (err) {
    console.error(err);
    return res.redirect('/signin?m=' + encodeURIComponent('We couldn’t send the email just now. Please try again.'));
  }

  res.send(layout({
    title: 'Check your email',
    body: `
      <div class="auth-box card">
        <h1 class="auth-title-sm">Check your email 💌</h1>
        <p class="hint">We sent a sign-in link to <b>${esc(email)}</b>. It works once and expires in 15 minutes.</p>
        ${devUrl ? `<div class="goodnote">Dev mode: email delivery is off, so here’s your link.<br>
          <a class="btn btn-gold btn-sm devlink" href="${esc(devUrl)}">Open sign-in link</a></div>` : ''}
      </div>`
  }));
});

app.get('/auth/:token', (req, res) => {
  const result = consumeMagicLink(req.params.token);
  if (!result) {
    return res.redirect('/signin?m=' + encodeURIComponent('That link expired or was already used. Request a fresh one.'));
  }
  sessionCookie(res, result.sessionToken);
  const profile = q.profile.get(result.user.id);
  res.redirect(profile && profile.onboarded ? '/dashboard' : '/welcome');
});

app.post('/signout', (req, res) => {
  if (req.sessionToken) q.deleteSession.run(req.sessionToken);
  res.clearCookie('pfg_session');
  res.redirect('/');
});

/* ---------- Onboarding ---------- */

app.get('/welcome', requireUser, (req, res) => {
  const causes = q.causes.all();
  const profile = q.profile.get(req.user.id) || {};
  res.send(layout({
    title: 'Welcome',
    user: req.user,
    body: `
      <div class="auth-box card wide">
        <h1 class="auth-title-sm">Welcome 👋 Tell us a little about you</h1>
        <p class="hint">Only your first name is required. Everything else helps match you with studies
        where your voice matters; it is never sold and researchers never see your profile.</p>
        <form method="post" action="/welcome" class="stackform">
          <label class="field"><span>First name *</span>
            <input type="text" name="name" required maxlength="60" value="${esc(profile.name || '')}"></label>
          <div class="grid2">
            <label class="field"><span>ZIP code <i>(helps find local studies)</i></span>
              <input type="text" name="zip" maxlength="10" value="${esc(profile.zip || '')}"></label>
            <label class="field"><span>Age range</span>
              <select name="age_band">
                <option value="">Prefer not to say</option>
                ${['18-24', '25-34', '35-54', '55plus'].map(v =>
                  `<option value="${v}" ${profile.age_band === v ? 'selected' : ''}>${v === '55plus' ? '55+' : v}</option>`).join('')}
              </select></label>
            <label class="field"><span>Household income <i>(helps fair representation)</i></span>
              <select name="income_band">
                <option value="">Prefer not to say</option>
                <option value="under50" ${profile.income_band === 'under50' ? 'selected' : ''}>Under $50k</option>
                <option value="50to100" ${profile.income_band === '50to100' ? 'selected' : ''}>$50k–$100k</option>
                <option value="over100" ${profile.income_band === 'over100' ? 'selected' : ''}>Over $100k</option>
              </select></label>
            <label class="field"><span>Where you live</span>
              <select name="area">
                <option value="">Prefer not to say</option>
                ${['urban', 'suburban', 'rural'].map(v =>
                  `<option value="${v}" ${profile.area === v ? 'selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}
              </select></label>
            <label class="field"><span>Languages you speak</span>
              <select name="languages">
                ${[1, 2, 3].map(v => `<option value="${v}" ${profile.languages === v ? 'selected' : ''}>${v === 3 ? '3 or more' : v}</option>`).join('')}
              </select></label>
            <label class="field"><span>Do you use assistive technology?</span>
              <select name="assistive">
                <option value="0" ${!profile.assistive ? 'selected' : ''}>No</option>
                <option value="1" ${profile.assistive ? 'selected' : ''}>Yes</option>
              </select></label>
          </div>
          <label class="field"><span>Pick your cause 💚 <i>(every session you complete sends money here; change anytime)</i></span>
            <select name="cause_id">
              ${causes.map(c => `<option value="${c.id}" ${profile.cause_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select></label>
          <button class="btn btn-green" type="submit" data-hearts>Save and see my dashboard</button>
        </form>
      </div>`
  }));
});

app.post('/welcome', requireUser, (req, res) => {
  const b = req.body;
  const name = String(b.name || '').trim().slice(0, 60);
  if (!name) return res.redirect('/welcome');
  const cause = q.causeById.get(Number(b.cause_id));
  q.createProfile.run(req.user.id);
  q.saveProfile.run({
    user_id: req.user.id,
    name,
    zip: String(b.zip || '').trim().slice(0, 10) || null,
    income_band: ['under50', '50to100', 'over100'].includes(b.income_band) ? b.income_band : null,
    area: ['urban', 'suburban', 'rural'].includes(b.area) ? b.area : null,
    languages: [1, 2, 3].includes(Number(b.languages)) ? Number(b.languages) : null,
    assistive: b.assistive === '1' ? 1 : 0,
    age_band: ['18-24', '25-34', '35-54', '55plus'].includes(b.age_band) ? b.age_band : null,
    cause_id: cause ? cause.id : null
  });
  res.redirect('/dashboard?m=' + encodeURIComponent('You’re in! We’ll invite you when studies match. 💚'));
});

/* ---------- Participant dashboard ---------- */

app.get('/dashboard', requireUser, (req, res) => {
  const profile = q.profile.get(req.user.id);
  if (!profile || !profile.onboarded) return res.redirect('/welcome');

  const causes = q.causes.all();
  const cause = profile.cause_id ? q.causeById.get(profile.cause_id) : null;
  const invites = q.invitesFor.all(req.user.id);
  const open = invites.filter(i => i.status === 'invited');
  const scheduled = invites.filter(i => i.status === 'accepted');
  const totals = q.totals.get(req.user.id);
  const completed = q.completedCount.get(req.user.id).n;
  const pace = q.quarterActivity.get(req.user.id).n;

  const inviteRow = (i) => `
    <div class="row">
      <div>
        <div class="main">${esc(i.title)}</div>
        <div class="meta">${i.length_min} min ${esc(i.method)} · ${money(i.incentive_cents)} to you · ${money(i.contribution_cents)} to your cause</div>
      </div>
      ${i.status === 'invited'
        ? `<form method="post" action="/invites/${i.id}/accept" class="inlineform">
             <button class="btn btn-blue btn-sm" data-hearts>Accept invite</button></form>`
        : '<span class="chip green">Scheduled ✓</span>'}
    </div>`;

  const earnings = q.earnings.all(req.user.id);

  res.send(layout({
    title: 'Dashboard',
    user: req.user,
    flash: flashOf(req),
    body: `
      <div class="page-head"><h1>Hi ${esc(profile.name)} 👋</h1></div>
      <p class="page-sub">Every session you complete pays you and sends money to your cause.</p>

      <div class="stats">
        <div class="stat"><div class="num green">${money(totals.earned_cents)}</div><div class="lbl">You've earned</div></div>
        <div class="stat"><div class="num gold">${money(totals.cause_cents)}</div><div class="lbl">Sent to your cause</div></div>
        <div class="stat"><div class="num">${completed}</div><div class="lbl">Sessions completed</div></div>
      </div>

      <div class="grid2">
        <div class="stack">
          <div class="card">
            <h2>Open invites</h2>
            <p class="hint">Studies you match. Joining is always optional, and always paid.</p>
            ${open.length || scheduled.length
              ? `<div class="rows">${[...open, ...scheduled].map(inviteRow).join('')}</div>`
              : '<p class="hint">No open invites right now. We’ll email you when a study matches. 🌱</p>'}
          </div>

          <div class="card">
            <h2>Earnings</h2>
            <p class="hint">Paid when a session is approved. No minimums, ever.</p>
            ${earnings.length
              ? `<div class="rows">${earnings.map(e => `
                  <div class="row">
                    <div><div class="main">${esc(e.title)}</div><div class="meta">${esc(e.created_at.slice(0, 10))}</div></div>
                    <span class="amt">${money(e.amount_cents)}</span>
                  </div>`).join('')}</div>`
              : '<p class="hint">Your first completed session will show up here.</p>'}
          </div>
        </div>

        <div class="stack">
          <div class="card">
            <h2>Your cause</h2>
            <p class="hint">Every session sends a contribution here, from the company's fee, never from your pay.</p>
            <form method="post" action="/cause" class="stackform">
              <label class="field"><span>Supporting</span>
                <select name="cause_id" onchange="this.form.submit()">
                  ${causes.map(c => `<option value="${c.id}" ${cause && cause.id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
                </select></label>
              <noscript><button class="btn btn-green btn-sm">Save</button></noscript>
            </form>
          </div>

          <div class="card">
            <h2>Your pace</h2>
            <p class="hint">We cap how often anyone is asked, so this never becomes a chore.</p>
            <div class="meter"><i class="blue" style="width:${Math.min(100, Math.round(pace / QUARTER_CAP * 100))}%"></i></div>
            <div class="meter-lbl"><span>${pace} of ${QUARTER_CAP} studies this quarter</span><span>resets quarterly</span></div>
          </div>
        </div>
      </div>`
  }));
});

app.post('/cause', requireUser, (req, res) => {
  const cause = q.causeById.get(Number(req.body.cause_id));
  if (cause) {
    q.setCause.run(cause.id, req.user.id);
    return res.redirect('/dashboard?m=' + encodeURIComponent('Done! Your sessions now support ' + cause.name + ' 💚'));
  }
  res.redirect('/dashboard');
});

app.post('/invites/:id/accept', requireUser, (req, res) => {
  const invite = q.invite.get(Number(req.params.id), req.user.id);
  if (!invite || invite.status !== 'invited') return res.redirect('/dashboard');
  if (q.quarterActivity.get(req.user.id).n >= QUARTER_CAP) {
    return res.redirect('/dashboard?m=' + encodeURIComponent('You’ve hit your quarterly pace cap. It resets soon; thank you for so much good. 💛'));
  }
  q.setInviteStatus.run('accepted', invite.id);
  res.redirect('/dashboard?m=' + encodeURIComponent('You’re in! We’ll email times to pick from. Your cause thanks you 💚'));
});

app.use('/researcher', researcher);

/* Dev-only: complete a session and write the ledger split, until the admin
   console exists. Lets the money flow be exercised end to end. */
if (DEV) {
  app.post('/dev/approve-study/:id', requireUser, (req, res) => {
    const id = Number(req.params.id);
    const changed = q.approveStudy.run(id).changes;
    if (changed) q.inviteAllToStudy.run(id);
    res.redirect('/researcher/studies/' + id + '?m=' +
      encodeURIComponent(changed ? 'Approved (dev). Invites are out to matching participants. 💌' : 'Study was not awaiting review.'));
  });

  app.post('/dev/complete/:id', requireUser, (req, res) => {
    const invite = q.invite.get(Number(req.params.id), req.user.id);
    if (invite && invite.status === 'accepted') {
      const study = db.prepare('SELECT * FROM studies WHERE id = ?').get(invite.study_id);
      const profile = q.profile.get(req.user.id);
      q.setInviteStatus.run('completed', invite.id);
      q.addLedger.run({ user_id: req.user.id, invite_id: invite.id, entry_type: 'incentive', amount_cents: study.incentive_cents, cause_id: null });
      q.addLedger.run({ user_id: req.user.id, invite_id: invite.id, entry_type: 'contribution', amount_cents: study.contribution_cents, cause_id: profile.cause_id });
    }
    res.redirect('/dashboard?m=' + encodeURIComponent('Session completed (dev). You got paid and your cause got funded. 💚'));
  });
}

const port = process.env.PORT || 4519;
app.listen(port, () => console.log('Participants for Good platform on http://localhost:' + port + (DEV ? ' (dev mode)' : '')));
