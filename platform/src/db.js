import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dbPath = process.env.DATABASE_PATH || path.join(root, 'data.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS causes (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    verified INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    name TEXT,
    zip TEXT,
    income_band TEXT,        -- under50 | 50to100 | over100
    area TEXT,               -- urban | suburban | rural
    languages INTEGER,       -- how many languages spoken
    assistive INTEGER,       -- uses assistive tech (0/1)
    age_band TEXT,           -- 18-24 | 25-34 | 35-54 | 55plus
    cause_id INTEGER REFERENCES causes(id),
    onboarded INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS magic_links (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS studies (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    method TEXT NOT NULL,          -- interview | usability | survey | diary
    length_min INTEGER NOT NULL,
    incentive_cents INTEGER NOT NULL,
    contribution_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open'   -- open | closed
  );

  CREATE TABLE IF NOT EXISTS invites (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    study_id INTEGER NOT NULL REFERENCES studies(id),
    status TEXT NOT NULL DEFAULT 'invited', -- invited | accepted | completed | declined
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, study_id)
  );

  -- The spine: every dollar traceable. Amounts in cents.
  CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    invite_id INTEGER NOT NULL REFERENCES invites(id),
    entry_type TEXT NOT NULL,      -- incentive | contribution
    amount_cents INTEGER NOT NULL,
    cause_id INTEGER REFERENCES causes(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_roles (
    user_id INTEGER NOT NULL REFERENCES users(id),
    role TEXT NOT NULL,            -- researcher | admin
    UNIQUE(user_id, role)
  );

  CREATE TABLE IF NOT EXISTS orgs (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS org_members (
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    UNIQUE(user_id)                -- v0: one org per user
  );

  -- Audience targets a researcher sets on a study. Tracked against fills;
  -- matching enforcement comes with the admin console.
  CREATE TABLE IF NOT EXISTS quota_lines (
    id INTEGER PRIMARY KEY,
    study_id INTEGER NOT NULL REFERENCES studies(id),
    variable TEXT NOT NULL,        -- income_under50 | rural | multilingual | assistive | age55 | first_time
    target_count INTEGER NOT NULL
  );
`);

/* Column migrations for tables that predate the researcher build. */
const studyCols = db.prepare('PRAGMA table_info(studies)').all().map(c => c.name);
if (!studyCols.includes('org_id')) db.exec('ALTER TABLE studies ADD COLUMN org_id INTEGER REFERENCES orgs(id)');
if (!studyCols.includes('tier')) db.exec("ALTER TABLE studies ADD COLUMN tier TEXT DEFAULT 'targeted'");
if (!studyCols.includes('ops_cents')) db.exec('ALTER TABLE studies ADD COLUMN ops_cents INTEGER DEFAULT 0');
if (!studyCols.includes('needed')) db.exec('ALTER TABLE studies ADD COLUMN needed INTEGER DEFAULT 8');
if (!studyCols.includes('created_at')) db.exec('ALTER TABLE studies ADD COLUMN created_at TEXT');

/* ---------- Seeds (idempotent) ---------- */

const seedCauses = [
  'Riverside Youth Alliance',
  'Eastside Food Pantry',
  'Open Door Crisis Line',
  'Green Blocks Community Gardens',
  'Rural Digital Access Fund'
];
const insertCause = db.prepare('INSERT OR IGNORE INTO causes (name, verified) VALUES (?, 1)');
for (const name of seedCauses) insertCause.run(name);

const seedStudies = [
  { title: 'Grocery app usability test', method: 'usability', length_min: 45, incentive_cents: 7000, contribution_cents: 4200 },
  { title: 'How you get around your city', method: 'interview', length_min: 30, incentive_cents: 5000, contribution_cents: 3000 }
];
const studyCount = db.prepare('SELECT COUNT(*) AS n FROM studies').get().n;
if (studyCount === 0) {
  const insertStudy = db.prepare(
    'INSERT INTO studies (title, method, length_min, incentive_cents, contribution_cents) VALUES (@title, @method, @length_min, @incentive_cents, @contribution_cents)'
  );
  for (const s of seedStudies) insertStudy.run(s);
}

/* ---------- Queries ---------- */

export const q = {
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  createUser: db.prepare('INSERT INTO users (email) VALUES (?)'),
  profile: db.prepare('SELECT * FROM profiles WHERE user_id = ?'),
  createProfile: db.prepare('INSERT OR IGNORE INTO profiles (user_id) VALUES (?)'),
  saveProfile: db.prepare(`
    UPDATE profiles SET name=@name, zip=@zip, income_band=@income_band, area=@area,
      languages=@languages, assistive=@assistive, age_band=@age_band, cause_id=@cause_id, onboarded=1
    WHERE user_id=@user_id`),
  setCause: db.prepare('UPDATE profiles SET cause_id = ? WHERE user_id = ?'),

  causes: db.prepare('SELECT * FROM causes WHERE verified = 1 ORDER BY name'),
  causeById: db.prepare('SELECT * FROM causes WHERE id = ?'),

  createMagicLink: db.prepare('INSERT INTO magic_links (token, email, expires_at) VALUES (?, ?, ?)'),
  recentMagicLink: db.prepare(`
    SELECT * FROM magic_links WHERE email = ? AND used = 0
      AND created_at > datetime('now', '-60 seconds')`),
  magicLink: db.prepare(`SELECT * FROM magic_links WHERE token = ? AND used = 0 AND expires_at > datetime('now')`),
  useMagicLink: db.prepare('UPDATE magic_links SET used = 1 WHERE token = ?'),

  createSession: db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)'),
  session: db.prepare(`SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')`),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),

  openStudies: db.prepare(`SELECT * FROM studies WHERE status = 'open'`),
  inviteToOpenStudies: db.prepare(`
    INSERT OR IGNORE INTO invites (user_id, study_id)
    SELECT ?, id FROM studies WHERE status = 'open'`),
  invitesFor: db.prepare(`
    SELECT invites.*, studies.title, studies.method, studies.length_min,
           studies.incentive_cents, studies.contribution_cents
    FROM invites JOIN studies ON studies.id = invites.study_id
    WHERE invites.user_id = ? ORDER BY invites.created_at DESC`),
  invite: db.prepare('SELECT * FROM invites WHERE id = ? AND user_id = ?'),
  setInviteStatus: db.prepare('UPDATE invites SET status = ? WHERE id = ?'),
  quarterActivity: db.prepare(`
    SELECT COUNT(*) AS n FROM invites
    WHERE user_id = ? AND status IN ('accepted', 'completed')
      AND created_at >= datetime('now', 'start of year', '+' || (((CAST(strftime('%m','now') AS INTEGER) - 1) / 3) * 3) || ' months')`),

  addLedger: db.prepare(`
    INSERT INTO ledger (user_id, invite_id, entry_type, amount_cents, cause_id)
    VALUES (@user_id, @invite_id, @entry_type, @amount_cents, @cause_id)`),
  earnings: db.prepare(`
    SELECT ledger.*, studies.title FROM ledger
    JOIN invites ON invites.id = ledger.invite_id
    JOIN studies ON studies.id = invites.study_id
    WHERE ledger.user_id = ? AND ledger.entry_type = 'incentive'
    ORDER BY ledger.created_at DESC`),
  totals: db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN entry_type = 'incentive' THEN amount_cents END), 0) AS earned_cents,
      COALESCE(SUM(CASE WHEN entry_type = 'contribution' THEN amount_cents END), 0) AS cause_cents
    FROM ledger WHERE user_id = ?`),
  completedCount: db.prepare(`
    SELECT COUNT(*) AS n FROM invites WHERE user_id = ? AND status = 'completed'`),

  /* ---- Researcher ---- */
  rolesFor: db.prepare('SELECT role FROM user_roles WHERE user_id = ?'),
  addRole: db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)'),
  createOrg: db.prepare('INSERT INTO orgs (name) VALUES (?)'),
  addOrgMember: db.prepare('INSERT OR IGNORE INTO org_members (org_id, user_id) VALUES (?, ?)'),
  orgFor: db.prepare(`
    SELECT orgs.* FROM orgs JOIN org_members ON org_members.org_id = orgs.id
    WHERE org_members.user_id = ?`),

  createStudy: db.prepare(`
    INSERT INTO studies (title, method, length_min, incentive_cents, contribution_cents,
                         ops_cents, needed, tier, status, org_id, created_at)
    VALUES (@title, @method, @length_min, @incentive_cents, @contribution_cents,
            @ops_cents, @needed, @tier, 'submitted', @org_id, datetime('now'))`),
  studiesByOrg: db.prepare(`
    SELECT studies.*,
      (SELECT COUNT(*) FROM invites WHERE study_id = studies.id AND status IN ('accepted','completed')) AS filled,
      (SELECT COUNT(*) FROM invites WHERE study_id = studies.id AND status = 'completed') AS done
    FROM studies WHERE org_id = ? ORDER BY id DESC`),
  studyById: db.prepare('SELECT * FROM studies WHERE id = ?'),
  approveStudy: db.prepare(`UPDATE studies SET status = 'open' WHERE id = ? AND status = 'submitted'`),
  inviteAllToStudy: db.prepare(`
    INSERT OR IGNORE INTO invites (user_id, study_id)
    SELECT user_id, ? FROM profiles WHERE onboarded = 1`),

  addQuota: db.prepare('INSERT INTO quota_lines (study_id, variable, target_count) VALUES (?, ?, ?)'),
  quotasFor: db.prepare('SELECT * FROM quota_lines WHERE study_id = ?'),

  /* Aggregate panel counts per audience variable. Researchers only ever see these numbers. */
  panelCounts: {
    income_under50: db.prepare(`SELECT COUNT(*) AS n FROM profiles WHERE onboarded=1 AND income_band='under50'`),
    rural: db.prepare(`SELECT COUNT(*) AS n FROM profiles WHERE onboarded=1 AND area='rural'`),
    multilingual: db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE onboarded=1 AND languages >= 2'),
    assistive: db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE onboarded=1 AND assistive = 1'),
    age55: db.prepare(`SELECT COUNT(*) AS n FROM profiles WHERE onboarded=1 AND age_band='55plus'`),
    first_time: db.prepare(`
      SELECT COUNT(*) AS n FROM profiles WHERE onboarded=1 AND user_id NOT IN
        (SELECT user_id FROM invites WHERE status = 'completed')`)
  },
  panelSize: db.prepare('SELECT COUNT(*) AS n FROM profiles WHERE onboarded = 1'),

  /* Sessions a researcher may see: first name + audience traits only. Never email. */
  studySessions: db.prepare(`
    SELECT invites.id, invites.status, invites.created_at,
           profiles.name, profiles.income_band, profiles.area, profiles.languages,
           profiles.assistive, profiles.age_band
    FROM invites JOIN profiles ON profiles.user_id = invites.user_id
    WHERE invites.study_id = ? AND invites.status IN ('accepted','completed')
    ORDER BY invites.created_at`),
  studyImpact: db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) AS total_cents, COUNT(DISTINCT ledger.cause_id) AS causes
    FROM ledger JOIN invites ON invites.id = ledger.invite_id
    WHERE invites.study_id = ? AND ledger.entry_type = 'contribution'`),
  studyImpactByCause: db.prepare(`
    SELECT causes.name, SUM(ledger.amount_cents) AS cents
    FROM ledger JOIN invites ON invites.id = ledger.invite_id
    JOIN causes ON causes.id = ledger.cause_id
    WHERE invites.study_id = ? AND ledger.entry_type = 'contribution'
    GROUP BY causes.id ORDER BY cents DESC`),

  /* ---- Admin (trusted: may see emails and full profiles) ---- */
  studiesByStatus: db.prepare(`
    SELECT studies.*, orgs.name AS org_name,
      (SELECT COUNT(*) FROM invites WHERE study_id = studies.id AND status IN ('accepted','completed')) AS filled,
      (SELECT COUNT(*) FROM invites WHERE study_id = studies.id AND status = 'completed') AS done
    FROM studies LEFT JOIN orgs ON orgs.id = studies.org_id
    WHERE studies.status = ? ORDER BY studies.id DESC`),
  declineStudy: db.prepare(`UPDATE studies SET status = 'declined' WHERE id = ? AND status = 'submitted'`),
  closeStudy: db.prepare(`UPDATE studies SET status = 'closed' WHERE id = ? AND status = 'open'`),

  adminStudySessions: db.prepare(`
    SELECT invites.id, invites.status, invites.created_at, users.email,
           profiles.name, profiles.income_band, profiles.area, profiles.languages,
           profiles.assistive, profiles.age_band, causes.name AS cause_name
    FROM invites
    JOIN users ON users.id = invites.user_id
    JOIN profiles ON profiles.user_id = invites.user_id
    LEFT JOIN causes ON causes.id = profiles.cause_id
    WHERE invites.study_id = ? ORDER BY
      CASE invites.status WHEN 'accepted' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END, invites.created_at`),
  inviteWithStudy: db.prepare(`
    SELECT invites.*, studies.incentive_cents, studies.contribution_cents, studies.status AS study_status
    FROM invites JOIN studies ON studies.id = invites.study_id WHERE invites.id = ?`),
  setNoShow: db.prepare(`UPDATE invites SET status = 'no_show' WHERE id = ? AND status = 'accepted'`),

  adminPanel: db.prepare(`
    SELECT users.id AS user_id, users.email, profiles.*, causes.name AS cause_name,
      (SELECT COUNT(*) FROM invites WHERE user_id = users.id AND status IN ('accepted','completed')
        AND created_at >= datetime('now', 'start of year', '+' || (((CAST(strftime('%m','now') AS INTEGER) - 1) / 3) * 3) || ' months')) AS pace,
      (SELECT COUNT(*) FROM invites WHERE user_id = users.id AND status = 'completed') AS lifetime_done
    FROM profiles
    JOIN users ON users.id = profiles.user_id
    LEFT JOIN causes ON causes.id = profiles.cause_id
    WHERE profiles.onboarded = 1 ORDER BY users.id`),
  inviteOne: db.prepare('INSERT OR IGNORE INTO invites (user_id, study_id) VALUES (?, ?)'),

  platformTotals: db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN entry_type = 'incentive' THEN amount_cents END), 0) AS incentives_cents,
      COALESCE(SUM(CASE WHEN entry_type = 'contribution' THEN amount_cents END), 0) AS causes_cents
    FROM ledger`)
};

export const QUARTER_CAP = 6;
