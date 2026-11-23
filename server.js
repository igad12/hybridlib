const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const path = require('path');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const PORT = process.env.PORT || 3000;
const DAY = 864e5;
// Same policy constants as store.js, now enforced on the server
const RULES = { loanDays: 14, maxLoans: 3, maxRenewals: 1, finePerDay: 2, holdDays: 2, blockFine: 100 };

const db = new Database(process.env.DB_FILE || path.join(__dirname, 'library.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE, password TEXT, role TEXT, roll TEXT);
CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, title TEXT, author TEXT, category TEXT, total INTEGER, year INTEGER, isbn TEXT UNIQUE, descr TEXT, loc TEXT);
CREATE TABLE IF NOT EXISTS loans (id TEXT PRIMARY KEY, userId TEXT, bookId TEXT, issued INTEGER, due INTEGER, returned INTEGER, renewals INTEGER DEFAULT 0, paid INTEGER DEFAULT 0, lastNote TEXT);
CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, userId TEXT, bookId TEXT, status TEXT, created INTEGER, expires INTEGER);
CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, userId TEXT, msg TEXT, date INTEGER, read INTEGER DEFAULT 0);
`);

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const now = () => Date.now();
const today = () => new Date().toISOString().slice(0, 10);

// ---------- derived values (computed, never stored) ----------
const heldCount = (bookId, exceptUser) =>
  db.prepare(`SELECT COUNT(*) c FROM reservations WHERE bookId=? AND status='ready' AND userId<>?`).get(bookId, exceptUser || '').c;
const openCount = (bookId) => db.prepare('SELECT COUNT(*) c FROM loans WHERE bookId=? AND returned IS NULL').get(bookId).c;
const avail = (b, forUser) => b.total - openCount(b.id) - heldCount(b.id, forUser);
const lateDays = (l) => Math.max(0, Math.ceil(((l.returned || now()) - l.due) / DAY));
const fineOf = (l) => lateDays(l) * RULES.finePerDay;
const unpaidFine = (userId) =>
  db.prepare('SELECT * FROM loans WHERE userId=? AND paid=0').all(userId).reduce((s, l) => s + fineOf(l), 0);
const userOpenLoans = (userId) => db.prepare('SELECT COUNT(*) c FROM loans WHERE userId=? AND returned IS NULL').get(userId).c;
const getBook = (id) => db.prepare('SELECT * FROM books WHERE id=?').get(id);
const notify = (userId, msg) => db.prepare('INSERT INTO notes (id,userId,msg,date,read) VALUES (?,?,?,?,0)').run(uid(), userId, msg, now());
const addLoan = (userId, bookId) =>
  db.prepare('INSERT INTO loans (id,userId,bookId,issued,due,returned,renewals,paid,lastNote) VALUES (?,?,?,?,?,NULL,0,0,NULL)')
    .run(uid(), userId, bookId, now(), now() + RULES.loanDays * DAY);

const fail = (code, error) => { const e = new Error(error); e.code = code; throw e; };

// ---------- seed ----------
function seed() {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c) return;
  const ins = db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)');
  ins.run('u1', 'Librarian', 'librarian@library.com', bcrypt.hashSync('admin123', 10), 'librarian', null);
  ins.run('u2', 'Aarav Sharma', 'student@library.com', bcrypt.hashSync('student123', 10), 'student', 'CS101');
  ins.run('u3', 'Riya Patel', 'riya@library.com', bcrypt.hashSync('student123', 10), 'student', 'CS102');
  const books = [
    ['Introduction to Algorithms', 'T. Cormen', 'Computer Science', 3, 2009, '9780262033848', 'CLRS: the standard algorithms text.', 'Main|2|A|R4|S2'],
    ['Clean Code', 'Robert C. Martin', 'Computer Science', 2, 2008, '9780132350884', 'Writing readable, maintainable code.', 'Main|2|A|R5|S1'],
    ['Database System Concepts', 'Silberschatz', 'Computer Science', 2, 2019, '9780078022159', 'Relational model, SQL, transactions.', 'Main|2|B|R1|S3'],
    ['Operating System Concepts', 'Galvin', 'Computer Science', 2, 2018, '9781119456339', 'Processes, memory, file systems.', 'Main|2|B|R2|S1'],
    ['Engineering Mathematics', 'B. S. Grewal', 'Mathematics', 4, 2017, '9788174091955', 'Calculus, algebra, differential equations.', 'Main|1|A|R1|S1'],
    ['Concepts of Physics', 'H. C. Verma', 'Physics', 3, 2015, '9788177091878', 'Mechanics, waves, optics.', 'Main|1|B|R3|S2'],
    ['Wings of Fire', 'A. P. J. Abdul Kalam', 'Biography', 2, 1999, '9788173711466', 'Autobiography of the Missile Man.', 'Annex|1|C|R1|S1'],
    ['The Guide', 'R. K. Narayan', 'Fiction', 2, 1958, '9780143039648', 'Classic Indian novel.', 'Annex|1|C|R2|S2'],
    ['Discovery of India', 'Jawaharlal Nehru', 'History', 1, 1946, '9780143031031', 'India\'s history and culture.', 'Annex|1|D|R1|S1'],
    ['Digital Logic Design', 'M. Morris Mano', 'Electronics', 3, 2013, '9780132774208', 'Gates, flip-flops, state machines.', 'Main|3|A|R2|S4'],
  ];
  const insB = db.prepare('INSERT INTO books VALUES (?,?,?,?,?,?,?,?,?)');
  const ids = books.map((b, i) => { const id = 'b' + (i + 1); insB.run(id, ...b); return id; });
  const insL = db.prepare('INSERT INTO loans (id,userId,bookId,issued,due,returned,renewals,paid,lastNote) VALUES (?,?,?,?,?,?,?,?,NULL)');
  insL.run('l1', 'u2', ids[0], now() - 20 * DAY, now() - 6 * DAY, null, 0, 0); // overdue
  insL.run('l2', 'u2', ids[1], now() - 5 * DAY, now() + 9 * DAY, null, 0, 0);
  insL.run('l3', 'u3', ids[2], now() - 30 * DAY, now() - 16 * DAY, now() - 14 * DAY, 0, 1);
  insL.run('l4', 'u3', ids[5], now() - 12 * DAY, now() + 2 * DAY, null, 0, 0); // due soon
  db.prepare('INSERT INTO reservations VALUES (?,?,?,?,?,NULL)').run('r1', 'u3', ids[0], 'pending', now());
  notify('u2', 'Welcome to Hybrid Library!');
}
seed();

// ---------- scheduled check (real cron, runs without anyone logged in) ----------
function dailyCheck() {
  db.prepare(`SELECT * FROM reservations WHERE status='ready' AND expires < ?`).all(now()).forEach((r) => {
    db.prepare(`UPDATE reservations SET status='expired' WHERE id=?`).run(r.id);
    notify(r.userId, `Your reserved copy of "${getBook(r.bookId).title}" was not collected in time and has expired.`);
  });
  db.prepare('SELECT * FROM loans WHERE returned IS NULL').all().forEach((l) => {
    if (l.lastNote === today()) return;
    const title = getBook(l.bookId).title;
    if (lateDays(l) > 0) notify(l.userId, `"${title}" is overdue by ${lateDays(l)} day(s). Fine so far: Rs ${fineOf(l)}.`);
    else if (l.due - now() <= 2 * DAY) notify(l.userId, `"${title}" is due within 2 days.`);
    else return;
    db.prepare('UPDATE loans SET lastNote=? WHERE id=?').run(today(), l.id);
  });
}
dailyCheck();
cron.schedule('0 0 * * *', dailyCheck);

// ---------- app + auth ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const wrap = (fn) => (req, res) => {
  try { res.json(fn(req, res) ?? { ok: true }); }
  catch (e) { res.status(e.code && Number.isInteger(e.code) ? e.code : 500).json({ error: e.message }); }
};
const auth = (req, res, next) => {
  try {
    const t = (req.headers.authorization || '').replace('Bearer ', '');
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(jwt.verify(t, SECRET).id);
    if (!u) throw new Error();
    req.user = u; next();
  } catch { res.status(401).json({ error: 'Please log in again.' }); }
};
const librarian = (req, res, next) => (req.user.role === 'librarian' ? next() : res.status(403).json({ error: 'Librarian access only.' }));
const pub = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, roll: u.roll });
const token = (u) => jwt.sign({ id: u.id }, SECRET, { expiresIn: '7d' });

app.post('/api/auth/register', wrap((req) => {
  const { name, email, password, roll } = req.body;
  if (!name || !email || !password || password.length < 6) fail(400, 'Name, email and a password of 6+ characters are required.');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email.toLowerCase())) fail(409, 'That email is already registered.');
  const u = { id: uid(), name, email: email.toLowerCase(), password: bcrypt.hashSync(password, 10), role: 'student', roll: roll || null };
  db.prepare('INSERT INTO users VALUES (@id,@name,@email,@password,@role,@roll)').run(u);
  return { token: token(u), user: pub(u) };
}));
app.post('/api/auth/login', wrap((req) => {
  const u = db.prepare('SELECT * FROM users WHERE email=?').get((req.body.email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(req.body.password || '', u.password)) fail(401, 'Wrong email or password.');
  return { token: token(u), user: pub(u) };
}));
app.get('/api/me', auth, wrap((req) => ({ user: pub(req.user), unpaidFine: unpaidFine(req.user.id), rules: RULES })));
app.get('/api/users', auth, librarian, wrap(() => db.prepare(`SELECT id,name,email,roll FROM users WHERE role='student'`).all()));

// ---------- books ----------
app.get('/api/books', auth, wrap((req) => {
  const q = `%${(req.query.q || '').toLowerCase()}%`;
  return db.prepare(`SELECT * FROM books WHERE lower(title||author||category||isbn) LIKE ? ORDER BY title`).all(q)
    .map((b) => ({ ...b, available: avail(b, req.user.id), location: b.loc.split('|') }));
}));
app.post('/api/books', auth, librarian, wrap((req) => {
  const b = req.body;
  if (!b.title || !b.author || !b.isbn || !(b.total > 0)) fail(400, 'Title, author, ISBN and copies (1+) are required.');
  if (db.prepare('SELECT 1 FROM books WHERE isbn=?').get(b.isbn)) fail(409, 'A book with this ISBN already exists.');
  db.prepare('INSERT INTO books VALUES (?,?,?,?,?,?,?,?,?)').run(uid(), b.title, b.author, b.category || 'General', +b.total, +b.year || null, b.isbn, b.descr || '', b.loc || 'Main|1|A|R1|S1');
}));

const bookFields = (b) => {
  if (!b.title || !b.author || !b.isbn || !(+b.total > 0)) fail(400, 'Title, author, ISBN and copies (1+) are required.');
  return [b.title, b.author, b.category || 'General', +b.total, +b.year || null, b.isbn, b.descr || '', b.loc || 'Main|1|A|R1|S1'];
};
app.put('/api/books/:id', auth, librarian, wrap((req) => {
  const cur = getBook(req.params.id);
  if (!cur) fail(404, 'Book not found.');
  const f = bookFields(req.body);
  if (db.prepare('SELECT 1 FROM books WHERE isbn=? AND id<>?').get(f[5], cur.id)) fail(409, 'A book with this ISBN already exists.');
  if (f[3] < openCount(cur.id)) fail(400, `Copies cannot be fewer than the ${openCount(cur.id)} currently issued.`);
  db.prepare('UPDATE books SET title=?,author=?,category=?,total=?,year=?,isbn=?,descr=?,loc=? WHERE id=?').run(...f, cur.id);
}));
app.delete('/api/books/:id', auth, librarian, wrap((req) => {
  const cur = getBook(req.params.id);
  if (!cur) fail(404, 'Book not found.');
  if (openCount(cur.id)) fail(400, 'This book has copies issued. Return them before deleting.');
  db.prepare('DELETE FROM reservations WHERE bookId=?').run(cur.id);
  db.prepare('DELETE FROM loans WHERE bookId=?').run(cur.id);
  db.prepare('DELETE FROM books WHERE id=?').run(cur.id);
}));

// ---------- loans ----------
const loanView = (l) => ({ ...l, title: getBook(l.bookId).title, student: db.prepare('SELECT name FROM users WHERE id=?').get(l.userId).name, lateDays: lateDays(l), fine: fineOf(l) });
app.get('/api/loans', auth, wrap((req) => {
  const rows = req.user.role === 'librarian' ? db.prepare('SELECT * FROM loans ORDER BY issued DESC').all()
    : db.prepare('SELECT * FROM loans WHERE userId=? ORDER BY issued DESC').all(req.user.id);
  return rows.map(loanView);
}));
app.post('/api/loans', auth, librarian, wrap((req) => db.transaction(() => {
  const { userId, bookId } = req.body;
  const b = getBook(bookId), s = db.prepare(`SELECT * FROM users WHERE id=? AND role='student'`).get(userId);
  if (!s || !b) fail(400, 'Select a student and a book.');
  if (userOpenLoans(userId) >= RULES.maxLoans) fail(400, `Student already has ${RULES.maxLoans} books.`);
  if (db.prepare('SELECT 1 FROM loans WHERE userId=? AND bookId=? AND returned IS NULL').get(userId, bookId)) fail(400, 'Student already holds a copy of this book.');
  if (unpaidFine(userId) > RULES.blockFine) fail(400, `Unpaid fines exceed Rs ${RULES.blockFine}. Collect the fine first.`);
  const ready = db.prepare(`SELECT * FROM reservations WHERE userId=? AND bookId=? AND status='ready'`).get(userId, bookId);
  if (ready) db.prepare(`UPDATE reservations SET status='collected' WHERE id=?`).run(ready.id);
  else if (avail(b, userId) <= 0) fail(400, 'No copies available.');
  addLoan(userId, bookId);
  notify(userId, `"${b.title}" issued. Due in ${RULES.loanDays} days.`);
})()));
app.patch('/api/loans/:id/return', auth, librarian, wrap((req) => {
  const l = db.prepare('SELECT * FROM loans WHERE id=? AND returned IS NULL').get(req.params.id);
  if (!l) fail(404, 'Open loan not found.');
  db.prepare('UPDATE loans SET returned=? WHERE id=?').run(now(), l.id);
  const r = { ...l, returned: now() }, t = getBook(l.bookId).title;
  notify(l.userId, `"${t}" returned. Thank you!`);
  if (fineOf(r) > 0) notify(l.userId, `Fine for "${t}": Rs ${fineOf(r)} (${lateDays(r)} late day(s)).`);
}));
app.patch('/api/loans/:id/renew', auth, wrap((req) => {
  const l = db.prepare('SELECT * FROM loans WHERE id=? AND returned IS NULL').get(req.params.id);
  if (!l || (req.user.role !== 'librarian' && l.userId !== req.user.id)) fail(404, 'Open loan not found.');
  const b = getBook(l.bookId);
  if (lateDays(l) > 0) fail(400, 'Overdue books cannot be renewed.');
  if (l.renewals >= RULES.maxRenewals) fail(400, 'Renewal limit reached.');
  if (avail(b) <= 0 && db.prepare(`SELECT 1 FROM reservations WHERE bookId=? AND status IN ('pending','approved')`).get(b.id))
    fail(400, 'Another student is waiting for this book.');
  db.prepare('UPDATE loans SET due=due+?, renewals=renewals+1 WHERE id=?').run(RULES.loanDays / 2 * DAY, l.id);
  notify(l.userId, `"${b.title}" renewed for ${RULES.loanDays / 2} more days.`);
}));
app.patch('/api/loans/:id/pay', auth, librarian, wrap((req) => {
  const l = db.prepare('SELECT * FROM loans WHERE id=?').get(req.params.id);
  if (!l) fail(404, 'Loan not found.');
  db.prepare('UPDATE loans SET paid=1 WHERE id=?').run(l.id);
  notify(l.userId, `Fine of Rs ${fineOf(l)} for "${getBook(l.bookId).title}" marked as paid.`);
}));

// ---------- reservations (Click & Collect state machine) ----------
const ACTIVE = `('pending','approved','ready')`;
const resView = (r) => ({ ...r, title: getBook(r.bookId).title, student: db.prepare('SELECT name FROM users WHERE id=?').get(r.userId).name });
app.get('/api/reservations', auth, wrap((req) => {
  const rows = req.user.role === 'librarian' ? db.prepare('SELECT * FROM reservations ORDER BY created DESC').all()
    : db.prepare('SELECT * FROM reservations WHERE userId=? ORDER BY created DESC').all(req.user.id);
  return rows.map(resView);
}));
app.post('/api/reservations', auth, wrap((req) => {
  if (req.user.role !== 'student') fail(403, 'Only students can reserve.');
  const b = getBook(req.body.bookId);
  if (!b) fail(404, 'Book not found.');
  if (db.prepare(`SELECT COUNT(*) c FROM reservations WHERE userId=? AND status IN ${ACTIVE}`).get(req.user.id).c >= 3) fail(400, 'You can have at most 3 active reservations.');
  if (db.prepare(`SELECT 1 FROM reservations WHERE userId=? AND bookId=? AND status IN ${ACTIVE}`).get(req.user.id, b.id)) fail(400, 'You already reserved this book.');
  db.prepare('INSERT INTO reservations VALUES (?,?,?,?,?,NULL)').run(uid(), req.user.id, b.id, 'pending', now());
}));
app.patch('/api/reservations/:id', auth, wrap((req) => db.transaction(() => {
  const r = db.prepare('SELECT * FROM reservations WHERE id=?').get(req.params.id);
  const next = req.body.status;
  if (!r) fail(404, 'Reservation not found.');
  const isLib = req.user.role === 'librarian';
  if (!isLib && !(r.userId === req.user.id && next === 'cancelled')) fail(403, 'Not allowed.');
  const b = getBook(r.bookId);
  const flow = { pending: ['approved', 'cancelled'], approved: ['ready', 'cancelled'], ready: ['collected', 'cancelled'] };
  if (!(flow[r.status] || []).includes(next)) fail(400, `Cannot move from ${r.status} to ${next}.`);
  let expires = null;
  if (next === 'ready') {
    if (avail(b) <= 0) fail(400, 'No physical copy is free to hold.');
    expires = now() + RULES.holdDays * DAY;
    notify(r.userId, `"${b.title}" is ready. Collect within ${RULES.holdDays} days.`);
  } else if (next === 'approved') notify(r.userId, `Your reservation for "${b.title}" was approved.`);
  else if (next === 'collected') {
    if (userOpenLoans(r.userId) >= RULES.maxLoans) fail(400, `Student already has ${RULES.maxLoans} books.`);
    if (unpaidFine(r.userId) > RULES.blockFine) fail(400, `Unpaid fines exceed Rs ${RULES.blockFine}.`);
    db.prepare(`UPDATE reservations SET status='collected' WHERE id=?`).run(r.id);
    addLoan(r.userId, r.bookId);
    notify(r.userId, `"${b.title}" collected and issued. Due in ${RULES.loanDays} days.`);
    return;
  }
  db.prepare('UPDATE reservations SET status=?, expires=? WHERE id=?').run(next, expires, r.id);
})()));

// ---------- notifications ----------
app.get('/api/notes', auth, wrap((req) => db.prepare('SELECT * FROM notes WHERE userId=? ORDER BY date DESC LIMIT 50').all(req.user.id)));
app.post('/api/notes/read', auth, wrap((req) => { db.prepare('UPDATE notes SET read=1 WHERE userId=?').run(req.user.id); }));

app.listen(PORT, () => console.log(`Hybrid Library running on http://localhost:${PORT}`));
