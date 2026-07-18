import { Router } from 'express';
import { q } from './db.js';
import { requireAdmin } from './auth.js';
import { layout, esc, money } from './html.js';
import { TIERS, METHODS, QUOTA_VARIABLES } from './pricing.js';
import { QUARTER_CAP } from './db.js';

export const admin = Router();
admin.use(requireAdmin);

const flashOf = (req) => typeof req.query.m === 'string' ? req.query.m.slice(0, 200) : '';

const traitBadges = (p) => {
  const b = [];
  if (p.income_band === 'under50') b.push('Income &lt;$50k');
  if (p.area === 'rural') b.push('Rural');
  if (p.languages >= 2) b.push('Multilingual');
  if (p.assistive) b.push('Assistive tech');
  if (p.age_band === '55plus') b.push('55+');
  if (!p.lifetime_done) b.push('First-time');
  return b.map(t => `<span class="badge">${t}</span>`).join(' ');
};

const paceChip = (pace) => {
  if (pace >= QUARTER_CAP) return `<span class="chip coral">${pace}/${QUARTER_CAP} resting</span>`;
  if (pace >= QUARTER_CAP - 1) return `<span class="chip gold">${pace}/${QUARTER_CAP}</span>`;
  return `<span class="chip green">${pace}/${QUARTER_CAP}</span>`;
};

/* ---------- Console home: review queue + fielding ---------- */

admin.get('/', (req, res) => {
  const submitted = q.studiesByStatus.all('submitted');
  const fielding = q.studiesByStatus.all('open');
  const totals = q.platformTotals.get();
  const panelSize = q.panelSize.get().n;

  const studyRow = (s, actions) => `
    <div class="row">
      <div>
        <div class="main"><a href="/admin/studies/${s.id}">${esc(s.title)}</a></div>
        <div class="meta">${esc(s.org_name || 'PFG')} · ${s.length_min} min ${esc(METHODS[s.method]?.label || s.method)} ·
          ${esc(TIERS[s.tier]?.label || s.tier || '')} · ${money(s.incentive_cents)} + ${money(s.contribution_cents)} split ·
          ${s.filled} of ${s.needed} filled</div>
      </div>
      ${actions}
    </div>`;

  res.send(layout({
    title: 'Admin console', user: req.user, flash: flashOf(req),
    body: `
      <div class="page-head"><h1>Console</h1>
        <a class="btn btn-blue btn-sm" href="/admin/panel">Participant panel</a></div>
      <p class="page-sub">Approve studies, run sessions, and keep every promise the site makes.</p>

      <div class="stats">
        <div class="stat"><div class="num">${panelSize}</div><div class="lbl">Onboarded participants</div></div>
        <div class="stat"><div class="num green">${money(totals.causes_cents)}</div><div class="lbl">To causes, all time</div></div>
        <div class="stat"><div class="num gold">${money(totals.incentives_cents)}</div><div class="lbl">Paid to participants</div></div>
      </div>

      <div class="stack">
        <div class="card">
          <h2>Review queue ${submitted.length ? `<span class="chip gold">${submitted.length} waiting</span>` : ''}</h2>
          <p class="hint">Consent scope, incentive fairness, topic flags. Approving opens fielding and sends invites.</p>
          ${submitted.length ? `<div class="rows">${submitted.map(s => studyRow(s, `
            <div class="row-actions">
              <form method="post" action="/admin/studies/${s.id}/approve" class="inlineform">
                <button class="btn btn-green btn-sm" data-hearts>Approve</button></form>
              <form method="post" action="/admin/studies/${s.id}/decline" class="inlineform">
                <button class="btn btn-ghost btn-sm">Decline</button></form>
            </div>`)).join('')}</div>`
          : '<p class="hint">Nothing waiting. 🌱</p>'}
        </div>

        <div class="card">
          <h2>Fielding</h2>
          ${fielding.length ? `<div class="rows">${fielding.map(s => studyRow(s,
            `<span class="chip blue">${s.done} done</span>`)).join('')}</div>`
          : '<p class="hint">No studies in the field.</p>'}
        </div>
      </div>`
  }));
});

/* ---------- Study operations ---------- */

admin.get('/studies/:id', (req, res) => {
  const study = q.studyById.get(Number(req.params.id));
  if (!study) return res.redirect('/admin');
  const sessions = q.adminStudySessions.all(study.id);
  const quotas = q.quotasFor.all(study.id);

  const sessionRow = (s) => `
    <div class="row">
      <div>
        <div class="main">${esc(s.name || '(no name)')} <span class="meta">${esc(s.email)}</span></div>
        <div class="meta">${traitBadges(s)} · cause: ${esc(s.cause_name || 'none')}</div>
      </div>
      ${s.status === 'accepted' ? `
        <div class="row-actions">
          <form method="post" action="/admin/sessions/${s.id}/complete" class="inlineform">
            <button class="btn btn-green btn-sm" data-hearts>Complete &amp; pay</button></form>
          <form method="post" action="/admin/sessions/${s.id}/noshow" class="inlineform">
            <button class="btn btn-ghost btn-sm">No-show</button></form>
        </div>`
      : `<span class="chip ${({ completed: 'green', invited: 'blue', no_show: 'coral', declined: 'coral' })[s.status] || ''}">${esc(s.status.replace('_', '-'))}</span>`}
    </div>`;

  res.send(layout({
    title: 'Admin · ' + study.title, user: req.user, flash: flashOf(req),
    body: `
      <div class="page-head"><h1>${esc(study.title)}</h1>
        <span class="chip ${({ submitted: 'gold', open: 'blue', closed: 'green', declined: 'coral' })[study.status]}">${esc(study.status)}</span></div>
      <p class="page-sub">${study.length_min} min ${esc(METHODS[study.method]?.label || study.method)} ·
        ${esc(TIERS[study.tier]?.label || study.tier || '')} · needs ${study.needed} ·
        split ${money(study.incentive_cents)} / ${money(study.contribution_cents)} / ${money(study.ops_cents || 0)}
        ${study.status === 'open' ? `<form method="post" action="/admin/studies/${study.id}/close" class="inlineform">
          <button class="btn btn-ghost btn-sm">Close study</button></form>` : ''}</p>

      ${quotas.length ? `<div class="card" style="margin-bottom:20px;">
        <h2>Audience targets</h2>
        <div class="rows">${quotas.map(qu =>
          `<div class="row"><div class="main">${QUOTA_VARIABLES[qu.variable] || esc(qu.variable)}</div>
           <span class="chip blue">target ${qu.target_count} · ~${q.panelCounts[qu.variable].get().n} in panel</span></div>`).join('')}</div>
      </div>` : ''}

      <div class="card">
        <h2>Sessions</h2>
        <p class="hint">Completing a session pays the participant and funds their cause; both ledger rows are written together.</p>
        ${sessions.length ? `<div class="rows">${sessions.map(sessionRow).join('')}</div>`
          : '<p class="hint">No participant activity yet.</p>'}
      </div>`
  }));
});

admin.post('/studies/:id/approve', (req, res) => {
  const id = Number(req.params.id);
  const changed = q.approveStudy.run(id).changes;
  if (changed) q.inviteAllToStudy.run(id);
  res.redirect('/admin?m=' + encodeURIComponent(changed
    ? 'Approved. Invites are out; participants get paid fairly and causes get funded. 💚'
    : 'That study was not awaiting review.'));
});

admin.post('/studies/:id/decline', (req, res) => {
  const changed = q.declineStudy.run(Number(req.params.id)).changes;
  res.redirect('/admin?m=' + encodeURIComponent(changed ? 'Declined. The researcher can revise and resubmit.' : 'That study was not awaiting review.'));
});

admin.post('/studies/:id/close', (req, res) => {
  q.closeStudy.run(Number(req.params.id));
  res.redirect('/admin/studies/' + req.params.id + '?m=' + encodeURIComponent('Study closed.'));
});

/* Completing a session is the money moment: both ledger rows or neither. */
admin.post('/sessions/:id/complete', (req, res) => {
  const invite = q.inviteWithStudy.get(Number(req.params.id));
  if (invite && invite.status === 'accepted') {
    const profile = q.profile.get(invite.user_id);
    q.setInviteStatus.run('completed', invite.id);
    q.addLedger.run({ user_id: invite.user_id, invite_id: invite.id, entry_type: 'incentive', amount_cents: invite.incentive_cents, cause_id: null });
    q.addLedger.run({ user_id: invite.user_id, invite_id: invite.id, entry_type: 'contribution', amount_cents: invite.contribution_cents, cause_id: profile ? profile.cause_id : null });
    return res.redirect('/admin/studies/' + invite.study_id + '?m=' +
      encodeURIComponent('Session paid: ' + (money(invite.incentive_cents)) + ' to the participant, ' + money(invite.contribution_cents) + ' to their cause. 💚'));
  }
  res.redirect('/admin');
});

admin.post('/sessions/:id/noshow', (req, res) => {
  const invite = q.inviteWithStudy.get(Number(req.params.id));
  if (invite) q.setNoShow.run(invite.id);
  res.redirect('/admin/studies/' + (invite ? invite.study_id : '') + '?m=' + encodeURIComponent('Marked no-show. No money moves.'));
});

/* ---------- Participant panel (real data) ---------- */

admin.get('/panel', (req, res) => {
  const search = String(req.query.q || '').trim().toLowerCase();
  const f = {
    income: ['under50', '50to100', 'over100'].includes(req.query.income) ? req.query.income : '',
    area: ['urban', 'suburban', 'rural'].includes(req.query.area) ? req.query.area : '',
    assistive: req.query.assistive === '1',
    multilingual: req.query.multilingual === '1',
    capacity: req.query.capacity === '1'
  };

  let people = q.adminPanel.all();
  if (search) people = people.filter(p => ((p.name || '') + p.email).toLowerCase().includes(search));
  if (f.income) people = people.filter(p => p.income_band === f.income);
  if (f.area) people = people.filter(p => p.area === f.area);
  if (f.assistive) people = people.filter(p => p.assistive);
  if (f.multilingual) people = people.filter(p => p.languages >= 2);
  if (f.capacity) people = people.filter(p => p.pace < QUARTER_CAP);

  const studies = q.studiesByStatus.all('open');
  const studyOptions = studies.map(s => `<option value="${s.id}">${esc(s.title)}</option>`).join('');

  res.send(layout({
    title: 'Participant panel', user: req.user, flash: flashOf(req),
    body: `
      <div class="page-head"><h1>Participant panel</h1>
        <span class="chip blue">${people.length} shown</span></div>
      <p class="page-sub">The real panel. Invite people to fielding studies; the pace cap is enforced for you.</p>

      <div class="card">
        <form method="get" action="/admin/panel" class="filters">
          <input type="search" name="q" value="${esc(search)}" placeholder="Search name or email…" aria-label="Search">
          <select name="income" aria-label="Income filter">
            <option value="">Income: any</option>
            <option value="under50" ${f.income === 'under50' ? 'selected' : ''}>Under $50k</option>
            <option value="50to100" ${f.income === '50to100' ? 'selected' : ''}>$50–100k</option>
            <option value="over100" ${f.income === 'over100' ? 'selected' : ''}>Over $100k</option>
          </select>
          <select name="area" aria-label="Area filter">
            <option value="">Area: any</option>
            ${['urban', 'suburban', 'rural'].map(v => `<option value="${v}" ${f.area === v ? 'selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}
          </select>
          <label class="inline"><input type="checkbox" name="assistive" value="1" ${f.assistive ? 'checked' : ''}> Assistive tech</label>
          <label class="inline"><input type="checkbox" name="multilingual" value="1" ${f.multilingual ? 'checked' : ''}> Multilingual</label>
          <label class="inline"><input type="checkbox" name="capacity" value="1" ${f.capacity ? 'checked' : ''}> Has capacity</label>
          <button class="btn btn-ghost btn-sm" type="submit">Filter</button>
        </form>

        <div class="ptable-wrap">
          <table class="ptable">
            <thead><tr><th>Person</th><th>Profile</th><th>Cause</th><th>Pace</th><th></th></tr></thead>
            <tbody>
              ${people.map(p => `
                <tr>
                  <td><div class="p-name">${esc(p.name || '(onboarding)')}</div><div class="p-email">${esc(p.email)}</div></td>
                  <td><div class="badges">${traitBadges(p)}</div></td>
                  <td style="white-space:nowrap;">${esc(p.cause_name || 'none yet')}</td>
                  <td>${paceChip(p.pace)}</td>
                  <td>${studies.length ? `
                    <form method="post" action="/admin/panel/invite" class="row-actions">
                      <input type="hidden" name="user_id" value="${p.user_id}">
                      <select name="study_id" aria-label="Study">${studyOptions}</select>
                      <button class="btn btn-blue btn-sm" ${p.pace >= QUARTER_CAP ? 'disabled title="At quarterly cap"' : ''}>Invite</button>
                    </form>` : '<span class="meta">no open studies</span>'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="goodnote">🛡 Anyone at their quarterly cap can't be invited. The cap is a promise, and the tool keeps it.</div>
      </div>`
  }));
});

admin.post('/panel/invite', (req, res) => {
  const userId = Number(req.body.user_id);
  const study = q.studyById.get(Number(req.body.study_id));
  if (!study || study.status !== 'open') return res.redirect('/admin/panel?m=' + encodeURIComponent('That study is not fielding.'));
  if (q.quarterActivity.get(userId).n >= QUARTER_CAP) {
    return res.redirect('/admin/panel?m=' + encodeURIComponent('Protected by the cap: that person has done enough this quarter. 🛡'));
  }
  const added = q.inviteOne.run(userId, study.id).changes;
  res.redirect('/admin/panel?m=' + encodeURIComponent(added ? 'Invited to “' + study.title + '” 💌' : 'They already have an invite to that study.'));
});
