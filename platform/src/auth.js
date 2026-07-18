import crypto from 'node:crypto';
import { db, q } from './db.js';

const SESSION_DAYS = 30;
const LINK_MINUTES = 15;

export const DEV = process.env.NODE_ENV !== 'production';
export const APP_ORIGIN = process.env.APP_ORIGIN || 'http://localhost:' + (process.env.PORT || 4519);

const token = () => crypto.randomBytes(24).toString('hex');
const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString().replace('T', ' ').slice(0, 19);
const inDays = (d) => inMinutes(d * 24 * 60);

export function requestMagicLink(email) {
  // Per-email cooldown so the endpoint can't be used to spam someone's inbox.
  const recent = q.recentMagicLink.get(email);
  if (recent) return { token: recent.token, reused: true };
  const t = token();
  q.createMagicLink.run(t, email, inMinutes(LINK_MINUTES));
  return { token: t, reused: false };
}

export async function deliverMagicLink(email, linkToken) {
  const url = APP_ORIGIN + '/auth/' + linkToken;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log('[dev] magic link for ' + email + ': ' + url);
    return { delivered: false, url };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || 'Participants for Good <hello@participantsforgood.org>',
      to: email,
      subject: 'Your sign-in link',
      text: 'Sign in to Participants for Good:\n\n' + url +
        '\n\nThis link works once and expires in ' + LINK_MINUTES + ' minutes. ' +
        'If you did not request it, you can ignore this email.'
    })
  });
  if (!res.ok) throw new Error('Email send failed: ' + res.status + ' ' + (await res.text()));
  return { delivered: true, url: null };
}

/* Verifies a magic link and returns a signed-in user, creating the account
   (with profile row + invites to open studies) on first sign-in. */
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

export function consumeMagicLink(linkToken) {
  const link = q.magicLink.get(linkToken);
  if (!link) return null;
  q.useMagicLink.run(linkToken);

  let user = q.userByEmail.get(link.email);
  if (!user) {
    const id = q.createUser.run(link.email).lastInsertRowid;
    user = { id, email: link.email };
    q.createProfile.run(id);
    q.inviteToOpenStudies.run(id);
  }
  if (ADMIN_EMAILS.includes(link.email)) q.addRole.run(user.id, 'admin');
  const t = token();
  q.createSession.run(t, user.id, inDays(SESSION_DAYS));
  return { user, sessionToken: t };
}

/* In dev with no ADMIN_EMAILS configured, every signed-in user is an admin so the
   console can be exercised locally. In production, only listed emails ever are. */
function isAdmin(userId) {
  if (q.rolesFor.all(userId).some(r => r.role === 'admin')) return true;
  return DEV && ADMIN_EMAILS.length === 0;
}

export function sessionCookie(res, value) {
  res.cookie('pfg_session', value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !DEV,
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/'
  });
}

export function attachUser(req, _res, next) {
  req.user = null;
  const raw = req.headers.cookie || '';
  const match = raw.split(/;\s*/).find(c => c.startsWith('pfg_session='));
  if (match) {
    const sess = q.session.get(match.slice('pfg_session='.length));
    if (sess) {
      req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(sess.user_id);
      req.user.admin = isAdmin(req.user.id);
      req.sessionToken = sess.token;
    }
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect('/signin');
  if (!req.user.admin) return res.status(403).send('Not authorized');
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.redirect('/signin');
  next();
}
