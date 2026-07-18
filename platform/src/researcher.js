import { Router } from 'express';
import { q } from './db.js';
import { DEV, requireUser } from './auth.js';
import { layout, esc, money } from './html.js';
import { TIERS, METHODS, estimate, suggestedIncentiveCents, QUOTA_VARIABLES } from './pricing.js';

export const researcher = Router();
researcher.use(requireUser);

const isResearcher = (userId) => q.rolesFor.all(userId).some(r => r.role === 'researcher');

function requireResearcher(req, res, next) {
  if (!isResearcher(req.user.id)) return res.redirect('/researcher');
  req.org = q.orgFor.get(req.user.id);
  if (!req.org) return res.redirect('/researcher');
  next();
}

const statusChip = (s) => ({
  submitted: '<span class="chip gold">In review</span>',
  open: '<span class="chip blue">Fielding</span>',
  closed: '<span class="chip green">Complete</span>'
}[s] || `<span class="chip">${esc(s)}</span>`);

const traitBadges = (p) => {
  const b = [];
  if (p.income_band === 'under50') b.push('Income &lt;$50k');
  if (p.area === 'rural') b.push('Rural');
  if (p.languages >= 2) b.push('Multilingual');
  if (p.assistive) b.push('Assistive tech');
  if (p.age_band === '55plus') b.push('55+');
  return b.map(t => `<span class="badge">${t}</span>`).join(' ') || '<span class="badge">General panel</span>';
};

const flashOf = (req) => typeof req.query.m === 'string' ? req.query.m.slice(0, 200) : '';

/* ---------- Workspace home (and workspace creation) ---------- */

researcher.get('/', (req, res) => {
  if (!isResearcher(req.user.id) || !q.orgFor.get(req.user.id)) {
    return res.send(layout({
      title: 'For researchers', user: req.user,
      body: `
        <div class="auth-box card wide">
          <h1 class="auth-title-sm">Run studies with real people 💙</h1>
          <p class="hint">Create a workspace to plan studies, see the transparent cost split, and
          field with participants your panels never reach. Studies go through a quick review
          before fielding; you only ever see first names and matched criteria.</p>
          <form method="post" action="/researcher/workspace" class="stackform">
            <label class="field"><span>Organization or team name</span>
              <input type="text" name="org" required maxlength="80" placeholder="e.g. Acme Research, or just your name"></label>
            <button class="btn btn-blue" type="submit">Create workspace</button>
          </form>
          <p class="finehint">By continuing you agree to the
          <a href="https://participantsforgood.org/app/terms.html#researchers">research client terms</a>.</p>
        </div>`
    }));
  }

  const org = q.orgFor.get(req.user.id);
  const studies = q.studiesByOrg.all(org.id);
  let impactCents = 0;
  for (const s of studies) impactCents += q.studyImpact.get(s.id).total_cents;

  res.send(layout({
    title: 'Research workspace', user: req.user, flash: flashOf(req),
    body: `
      <div class="page-head"><h1>${esc(org.name)}</h1>
        <a class="btn btn-blue" href="/researcher/new">Plan a study</a></div>
      <p class="page-sub">Standard market-rate fees, split transparently. You always see where every dollar goes.</p>

      <div class="stats">
        <div class="stat"><div class="num">${studies.length}</div><div class="lbl">Studies</div></div>
        <div class="stat"><div class="num">${studies.reduce((a, s) => a + s.done, 0)}</div><div class="lbl">Sessions completed</div></div>
        <div class="stat"><div class="num green">${money(impactCents)}</div><div class="lbl">Sent to causes by your research</div></div>
      </div>

      <div class="card">
        <h2>Your studies</h2>
        ${studies.length ? `<div class="rows">${studies.map(s => `
          <div class="row">
            <div>
              <div class="main"><a href="/researcher/studies/${s.id}">${esc(s.title)}</a></div>
              <div class="meta">${s.length_min} min ${esc(METHODS[s.method]?.label || s.method)} ·
                ${s.filled} of ${s.needed} filled · ${s.done} completed</div>
            </div>
            ${statusChip(s.status)}
          </div>`).join('')}</div>`
        : '<p class="hint">No studies yet. Plan your first one; the estimate takes about a minute.</p>'}
      </div>`
  }));
});

researcher.post('/workspace', (req, res) => {
  const name = String(req.body.org || '').trim().slice(0, 80);
  if (!name) return res.redirect('/researcher');
  if (!q.orgFor.get(req.user.id)) {
    const orgId = q.createOrg.run(name).lastInsertRowid;
    q.addOrgMember.run(orgId, req.user.id);
    q.addRole.run(req.user.id, 'researcher');
  }
  res.redirect('/researcher?m=' + encodeURIComponent('Workspace ready. Plan your first study 💙'));
});

/* ---------- Study builder ---------- */

researcher.get('/new', requireResearcher, (req, res) => {
  const defaults = { method: 'interview', length: 45, needed: 12, tier: 'targeted' };
  const est = estimate({ method: defaults.method, lengthMin: defaults.length, needed: defaults.needed, tier: defaults.tier });
  res.send(layout({
    title: 'Plan a study', user: req.user,
    body: `
      <div class="page-head"><h1>Plan a study</h1></div>
      <p class="page-sub">Every study goes through a quick review: consent scope, incentive fairness, topic flags. Usually one business day.</p>
      <form method="post" action="/researcher/new" class="grid2" id="builder">
        <div class="stack">
          <div class="card">
            <h2>The study</h2>
            <label class="field"><span>Title (participants see this)</span>
              <input type="text" name="title" required maxlength="80" placeholder="e.g. Grocery app usability test"></label>
            <label class="field"><span>Method</span>
              <select name="method">${Object.entries(METHODS).map(([v, m]) =>
                `<option value="${v}" ${v === defaults.method ? 'selected' : ''}>${m.label}</option>`).join('')}</select></label>
            <label class="field"><span>Session length</span>
              <select name="length">${[15, 30, 45, 60, 90].map(v =>
                `<option value="${v}" ${v === defaults.length ? 'selected' : ''}>${v} min</option>`).join('')}</select></label>
            <label class="field"><span>Participants needed</span>
              <input type="number" name="needed" min="1" max="200" value="${defaults.needed}"></label>
            <label class="field"><span>Audience</span>
              <select name="tier">${Object.entries(TIERS).map(([v, t]) =>
                `<option value="${v}" ${v === defaults.tier ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
            <label class="field"><span>Participant incentive in dollars <i>(blank = our suggested fair floor)</i></span>
              <input type="number" name="incentive" min="10" step="5" placeholder="${est.incentive / 100}"></label>
          </div>

          <div class="card">
            <h2>Who you need to hear from</h2>
            <p class="hint">Set targets on aggregate panel traits. You never browse profiles; participants stay identity-masked.</p>
            ${Object.entries(QUOTA_VARIABLES).map(([v, label]) => `
              <div class="quota-row">
                <label class="field" style="margin:0;"><span>${label}</span></label>
                <input type="number" name="quota_${v}" min="0" max="200" value="0" aria-label="Target for ${label}">
                <span class="avail">~${q.panelCounts[v].get().n} in panel</span>
                <span></span>
              </div>`).join('')}
          </div>
        </div>

        <div class="stack">
          <div class="card">
            <h2>Estimate</h2>
            <p class="hint">Final numbers are confirmed at review; the split is the same one we publish in our open books.</p>
            <div class="breakdown">
              <div class="b-row"><span>Participant incentive</span><b>${money(est.incentive)}</b></div>
              <div class="b-row cause"><span>Contribution to their causes 💚</span><b>${money(est.contribution)}</b></div>
              <div class="b-row"><span>Recruiting &amp; operations</span><b>${money(est.ops)}</b></div>
              <div class="b-total"><span>Per completed session</span><span>${money(est.perSession)}</span></div>
              <div class="b-grand"><span>Estimated total</span><span>${money(est.total)}</span></div>
            </div>
            <p class="finehint">Panel today: ${q.panelSize.get().n} onboarded participants. We're a young panel and honest about it;
            hard quotas may field slower while nonprofit partnerships grow.</p>
            <button class="btn btn-blue" type="submit" style="margin-top:12px;">Submit for review</button>
          </div>
        </div>
      </form>`
  }));
});

researcher.post('/new', requireResearcher, (req, res) => {
  const b = req.body;
  const title = String(b.title || '').trim().slice(0, 80);
  const method = METHODS[b.method] ? b.method : 'interview';
  const lengthMin = [15, 30, 45, 60, 90].includes(Number(b.length)) ? Number(b.length) : 45;
  const needed = Math.min(200, Math.max(1, Number(b.needed) || 12));
  const tier = TIERS[b.tier] ? b.tier : 'targeted';
  if (!title) return res.redirect('/researcher/new');

  const incentiveCents = b.incentive ? Math.max(1000, Math.round(Number(b.incentive) * 100)) : suggestedIncentiveCents(method, lengthMin);
  const est = estimate({ method, lengthMin, needed, tier, incentiveCents });

  const studyId = q.createStudy.run({
    title, method, length_min: lengthMin, needed, tier,
    incentive_cents: est.incentive, contribution_cents: est.contribution,
    ops_cents: est.ops, org_id: req.org.id
  }).lastInsertRowid;

  for (const v of Object.keys(QUOTA_VARIABLES)) {
    const n = Math.min(200, Math.max(0, Number(b['quota_' + v]) || 0));
    if (n > 0) q.addQuota.run(studyId, v, n);
  }

  res.redirect('/researcher/studies/' + studyId + '?m=' +
    encodeURIComponent('Submitted for review. We check consent scope, incentive fairness, and topic flags, usually within one business day. 💙'));
});

/* ---------- Study detail ---------- */

researcher.get('/studies/:id', requireResearcher, (req, res) => {
  const study = q.studyById.get(Number(req.params.id));
  if (!study || study.org_id !== req.org.id) return res.redirect('/researcher');

  const est = estimate({
    method: study.method, lengthMin: study.length_min, needed: study.needed,
    tier: study.tier, incentiveCents: study.incentive_cents
  });
  const quotas = q.quotasFor.all(study.id);
  const sessions = q.studySessions.all(study.id);
  const impact = q.studyImpact.get(study.id);
  const byCause = q.studyImpactByCause.all(study.id);

  res.send(layout({
    title: study.title, user: req.user, flash: flashOf(req),
    body: `
      <div class="page-head"><h1>${esc(study.title)}</h1>${statusChip(study.status)}</div>
      <p class="page-sub">${study.length_min} min ${esc(METHODS[study.method]?.label || study.method)} ·
        ${esc(TIERS[study.tier]?.label || study.tier)} · ${study.needed} participants
        ${study.status === 'submitted' && DEV ? `
          <form method="post" action="/dev/approve-study/${study.id}" class="inlineform">
            <button class="btn btn-gold btn-sm">Approve &amp; field (dev)</button></form>` : ''}</p>

      <div class="grid2">
        <div class="stack">
          <div class="card">
            <h2>Sessions</h2>
            <p class="hint">🔒 First names and matched criteria only. Contact, scheduling, and payment run through us.</p>
            ${sessions.length ? `<div class="rows">${sessions.map(s => `
              <div class="row">
                <div>
                  <div class="main">${esc((s.name || 'Participant').split(' ')[0])}</div>
                  <div class="meta">${traitBadges(s)}</div>
                </div>
                ${s.status === 'completed' ? '<span class="chip green">Completed · paid ✓</span>' : '<span class="chip blue">Scheduled</span>'}
              </div>`).join('')}</div>`
            : `<p class="hint">${study.status === 'submitted' ? 'Sessions appear once the study clears review and fielding begins.' : 'No sessions yet. Invites are out.'}</p>`}
          </div>

          <div class="card">
            <h2>Audience targets</h2>
            ${quotas.length ? `<div class="rows">${quotas.map(qu => {
              const filled = sessions.filter(s => ({
                income_under50: s.income_band === 'under50', rural: s.area === 'rural',
                multilingual: s.languages >= 2, assistive: !!s.assistive,
                age55: s.age_band === '55plus', first_time: true
              }[qu.variable])).length;
              return `<div class="row">
                <div class="main">${QUOTA_VARIABLES[qu.variable] || esc(qu.variable)}</div>
                <span class="chip ${filled >= qu.target_count ? 'green' : 'gold'}">${filled} of ${qu.target_count}</span>
              </div>`;
            }).join('')}</div>` : '<p class="hint">No audience targets set for this study.</p>'}
          </div>
        </div>

        <div class="stack">
          <div class="card">
            <h2>Cost</h2>
            <div class="breakdown">
              <div class="b-row"><span>Participant incentive</span><b>${money(est.incentive)}</b></div>
              <div class="b-row cause"><span>Contribution to their causes 💚</span><b>${money(est.contribution)}</b></div>
              <div class="b-row"><span>Recruiting &amp; operations</span><b>${money(est.ops)}</b></div>
              <div class="b-total"><span>Per completed session</span><span>${money(est.perSession)}</span></div>
              <div class="b-grand"><span>Estimated total</span><span>${money(est.total)}</span></div>
            </div>
          </div>

          <div class="card">
            <h2>Impact receipt</h2>
            <p class="hint">What your research budget has funded so far. The same numbers appear in our open books.</p>
            ${impact.total_cents ? `
              <div class="stats" style="grid-template-columns:1fr 1fr;">
                <div class="stat"><div class="num green">${money(impact.total_cents)}</div><div class="lbl">To causes</div></div>
                <div class="stat"><div class="num">${sessions.filter(s => s.status === 'completed').length}</div><div class="lbl">Paid sessions</div></div>
              </div>
              <div class="rows">${byCause.map(c => `
                <div class="row"><div class="main">${esc(c.name)}</div><span class="amt">${money(c.cents)}</span></div>`).join('')}</div>`
            : '<p class="hint">Fills in as sessions complete. 🌱</p>'}
          </div>
        </div>
      </div>`
  }));
});
