// ---------- State & helpers ----------
let me = null, view = 'dash', filters = { q: '', cat: '', avail: false }, D = {};
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const badge = (cls, t) => `<span class="badge ${cls}">${esc(t)}</span>`;
const table = (head, rows, empty = 'Nothing here yet.') => rows.length
  ? `<div class="tw"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
  : `<p class="empty">${empty}</p>`;
const locHtml = (l) => `<div class="crumbs">${['Building', 'Floor', 'Wing', 'Rack', 'Shelf'].map((n, i) => `<span>${n} ${esc(l[i])}</span>`).join('<i>→</i>')}</div>`;
const COLORS = ['#4338ca', '#0e7490', '#b45309', '#15803d', '#be123c', '#7c3aed'];
const colorOf = (s) => COLORS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const lib = () => me.user.role === 'librarian';

let toastTimer;
function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : ''); clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ''), 2400); }
function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').hidden = false; }
function closeModal() { $('#modal').hidden = true; }

async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('hl_token') || '') }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && me) logout();
  if (!r.ok) throw new Error(d.error || 'Something went wrong.');
  return d;
}
// run an action, toast the result, refresh the screen
async function run(fn, msg) { try { await fn(); if (msg) toast(msg); await render(); } catch (e) { toast(e.message, true); } }

// ---------- Auth ----------
function authTab(t) {
  $('#fLogin').hidden = t !== 'login'; $('#fReg').hidden = t !== 'reg';
  $('#tLogin').classList.toggle('on', t === 'login'); $('#tReg').classList.toggle('on', t === 'reg');
}
function demo(role) {
  $('#lEmail').value = role === 'librarian' ? 'librarian@library.com' : 'student@library.com';
  $('#lPass').value = role === 'librarian' ? 'admin123' : 'student123';
}
async function login(e) {
  e.preventDefault();
  try { const d = await api('/auth/login', 'POST', { email: $('#lEmail').value.trim().toLowerCase(), password: $('#lPass').value }); localStorage.setItem('hl_token', d.token); await start(); }
  catch (err) { toast(err.message, true); }
}
async function register(e) {
  e.preventDefault();
  try { const d = await api('/auth/register', 'POST', { name: $('#rName').value.trim(), roll: $('#rRoll').value.trim(), email: $('#rEmail').value.trim().toLowerCase(), password: $('#rPass').value }); localStorage.setItem('hl_token', d.token); await start(); }
  catch (err) { toast(err.message, true); }
}
function logout() { localStorage.removeItem('hl_token'); me = null; $('#app').hidden = true; $('#auth').hidden = false; closeModal(); }
async function start() {
  me = await api('/me'); view = 'dash';
  $('#auth').hidden = true; $('#app').hidden = false; await render();
}

// ---------- Navigation & render ----------
const NAV = {
  student: [['dash', 'Dashboard'], ['cat', 'Catalogue'], ['loans', 'My books'], ['res', 'Reservations'], ['fines', 'Fines'], ['notes', 'Notifications']],
  librarian: [['dash', 'Dashboard'], ['books', 'Manage books'], ['issue', 'Issue & return'], ['res', 'Reservations'], ['fines', 'Fines']],
};
function go(v) { view = v; render(); window.scrollTo(0, 0); }
async function render() {
  const role = me.user.role;
  const [info, books, loans, res, notes, users] = await Promise.all([
    api('/me'), api('/books'), api('/loans'), api('/reservations'),
    role === 'student' ? api('/notes') : [], role === 'librarian' ? api('/users') : [],
  ]);
  me = info; D = { books, loans, res, notes, users };
  $('#nav').innerHTML = NAV[role].map(([k, n]) => `<button class="${view === k ? 'on' : ''}" onclick="go('${k}')">${n}</button>`).join('');
  $('#title').textContent = NAV[role].find(([k]) => k === view)[1];
  $('#who').textContent = `${me.user.name} (${role})`;
  const unread = notes.filter((n) => !n.read).length;
  $('#bell').hidden = role !== 'student'; $('#bellN').hidden = !unread || view === 'notes'; $('#bellN').textContent = unread;
  VIEWS[role][view]();
}

// ---------- Shared data helpers ----------
const open = () => D.loans.filter((l) => !l.returned);
const activeRes = (r) => ['pending', 'approved', 'ready'].includes(r.status);
const stat = (n, label, cls = '') => `<div class="stat ${cls}"><b>${n}</b>${label}</div>`;
const resBadge = (s) => badge({ pending: 'warn', approved: 'gray', ready: 'ok', collected: 'ok' }[s] || 'bad', s);

// ---------- Student views ----------
function dashStudent() {
  const o = open(), over = o.filter((l) => l.lateDays > 0);
  const soon = o.filter((l) => !l.lateDays).sort((a, b) => a.due - b.due);
  $('#content').innerHTML = `<div class="stats">${stat(o.length, 'Books issued')}${stat(over.length, 'Overdue', over.length ? 'bad' : '')}${stat('Rs ' + me.unpaidFine, 'Pending fine', me.unpaidFine ? 'bad' : '')}${stat(D.res.filter(activeRes).length, 'Active reservations')}</div>
  <div class="card"><h2>Upcoming due dates</h2>${table(['Book', 'Due'], soon.map((l) => `<tr><td>${esc(l.title)}</td><td>${fmt(l.due)}</td></tr>`), 'No upcoming due dates.')}</div>`;
}
function catalogue() {
  const cats = [...new Set(D.books.map((b) => b.category))].sort();
  $('#content').innerHTML = `<div class="filters"><input id="fq" placeholder="Search title, author, category or ISBN" value="${esc(filters.q)}" oninput="filters.q=this.value;renderGrid()">
  <select onchange="filters.cat=this.value;renderGrid()"><option value="">All categories</option>${cats.map((c) => `<option ${filters.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
  <label><input type="checkbox" ${filters.avail ? 'checked' : ''} onchange="filters.avail=this.checked;renderGrid()"> Available only</label></div><div id="grid" class="grid"></div>`;
  renderGrid();
}
function renderGrid() {
  const q = filters.q.toLowerCase();
  const list = D.books.filter((b) => (!q || `${b.title} ${b.author} ${b.category} ${b.isbn}`.toLowerCase().includes(q)) && (!filters.cat || b.category === filters.cat) && (!filters.avail || b.available > 0));
  $('#grid').innerHTML = list.map((b) => `<div class="book" style="--c:${colorOf(b.category)}" onclick="bookModal('${b.id}')"><b>${esc(b.title)}</b><span class="mute">${esc(b.author)}</span>
    <span>${badge('gray', b.category)} ${b.available > 0 ? badge('ok', b.available + ' available') : badge('bad', 'All issued')}</span></div>`).join('') || '<p class="empty">No books match these filters.</p>';
}
function bookModal(id) {
  const b = D.books.find((x) => x.id === id);
  const mine = D.loans.find((l) => l.bookId === id && !l.returned), r = D.res.find((x) => x.bookId === id && activeRes(x));
  const why = mine ? 'You already borrowed this' : r ? 'Already reserved' : '';
  openModal(`<h2>${esc(b.title)}</h2><p class="mute">${esc(b.author)} · ${esc(b.category)} · ${b.year || ''} · ISBN ${esc(b.isbn)}</p><p>${esc(b.descr)}</p>
  <h3>Where to find it</h3>${locHtml(b.location)}<p>${b.available} of ${b.total} copies available</p>
  <div class="acts">${lib() ? '' : `<button class="btn" ${why ? 'disabled' : ''} onclick="reserve('${id}')">${why || 'Reserve for pickup'}</button>`}<button class="btn alt" onclick="closeModal()">Close</button></div>`);
}
const reserve = (id) => run(async () => { await api('/reservations', 'POST', { bookId: id }); closeModal(); }, 'Reservation requested.');
const renew = (id) => run(() => api(`/loans/${id}/renew`, 'PATCH'), 'Loan renewed.');
function loansStudent() {
  const cur = open(), hist = D.loans.filter((l) => l.returned);
  $('#content').innerHTML = `<div class="card"><h2>Currently issued</h2>${table(['Book', 'Issued', 'Due', 'Status', ''], cur.map((l) => `<tr class="${l.lateDays ? 'late' : ''}"><td>${esc(l.title)}</td><td>${fmt(l.issued)}</td><td>${fmt(l.due)}</td>
    <td>${l.lateDays ? badge('bad', l.lateDays + ' days late · Rs ' + l.fine) : badge('ok', 'On time')}</td><td><button class="btn alt sm" onclick="renew('${l.id}')">Renew</button></td></tr>`), 'No books issued. Reserve one from the catalogue.')}</div>
  <div class="card"><h2>Borrowing history</h2>${table(['Book', 'Issued', 'Returned', 'Fine'], hist.map((l) => `<tr><td>${esc(l.title)}</td><td>${fmt(l.issued)}</td><td>${fmt(l.returned)}</td><td>${l.fine ? 'Rs ' + l.fine + (l.paid ? ' (paid)' : '') : '-'}</td></tr>`), 'No history yet.')}</div>`;
}
function resStudent() {
  $('#content').innerHTML = `<div class="card">${table(['Book', 'Requested', 'Status', 'Pickup', ''], D.res.map((r) => {
    const b = D.books.find((x) => x.id === r.bookId);
    return `<tr><td>${esc(r.title)}</td><td>${fmt(r.created)}</td><td>${resBadge(r.status)}</td>
    <td>${r.status === 'ready' ? `Collect by ${fmt(r.expires)}${locHtml(b.location)}` : '-'}</td>
    <td>${activeRes(r) ? `<button class="btn alt sm" onclick="setRes('${r.id}','cancelled')">Cancel</button>` : ''}</td></tr>`;
  }), 'No reservations yet.')}</div>`;
}
function finesStudent() {
  const rows = D.loans.filter((l) => l.fine > 0);
  $('#content').innerHTML = `<div class="stats">${stat('Rs ' + me.unpaidFine, 'Unpaid fines', me.unpaidFine ? 'bad' : '')}</div><div class="card"><p class="mute">Rs ${me.rules.finePerDay} per late day. New loans are blocked above Rs ${me.rules.blockFine}. Pay at the library counter.</p>
  ${table(['Book', 'Late days', 'Fine', 'Status'], rows.map((l) => `<tr><td>${esc(l.title)}</td><td>${l.lateDays}</td><td>Rs ${l.fine}</td><td>${l.paid ? badge('ok', 'Paid') : badge('bad', l.returned ? 'Unpaid' : 'Accruing')}</td></tr>`), 'You have no fines.')}</div>`;
}
async function notesView() {
  $('#content').innerHTML = `<div class="card">${table(['Message', 'Date', ''], D.notes.map((n) => `<tr><td>${esc(n.msg)}</td><td>${fmt(n.date)}</td><td>${n.read ? '' : badge('warn', 'new')}</td></tr>`), 'No notifications.')}</div>`;
  if (D.notes.some((n) => !n.read)) { await api('/notes/read', 'POST'); $('#bellN').hidden = true; }
}

// ---------- Librarian views ----------
function dashLib() {
  const o = open(), fines = D.loans.filter((l) => !l.paid).reduce((s, l) => s + l.fine, 0);
  const counts = D.loans.reduce((m, l) => ((m[l.title] = (m[l.title] || 0) + 1), m), {});
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $('#content').innerHTML = `<div class="stats">${stat(D.books.length, 'Titles')}${stat(D.books.reduce((s, b) => s + b.available, 0) + ' / ' + D.books.reduce((s, b) => s + b.total, 0), 'Copies free / total')}${stat(o.length, 'Issued now')}
  ${stat(o.filter((l) => l.lateDays).length, 'Overdue', 'bad')}${stat(D.users.length, 'Students')}${stat(D.res.filter((r) => ['pending', 'approved'].includes(r.status)).length, 'Reservations to handle')}${stat('Rs ' + fines, 'Fines pending', fines ? 'bad' : '')}</div>
  <div class="card"><h2>Most borrowed books</h2>${table(['Book', 'Times borrowed'], top.map(([t, n]) => `<tr><td>${esc(t)}</td><td>${n}</td></tr>`))}</div>`;
}
function booksLib() {
  $('#content').innerHTML = `<p><button class="btn" onclick="bookForm()">Add book</button></p><div class="card">${table(['Title', 'Author', 'Category', 'Copies', ''], D.books.map((b) => `<tr><td>${esc(b.title)}</td><td>${esc(b.author)}</td><td>${esc(b.category)}</td><td>${b.available} / ${b.total}</td>
    <td class="acts"><button class="btn alt sm" onclick="bookForm('${b.id}')">Edit</button><button class="btn bad sm" onclick="delBook('${b.id}')">Delete</button></td></tr>`))}</div>`;
}
function bookForm(id) {
  const b = id ? D.books.find((x) => x.id === id) : { location: ['Main', '1', 'A', 'R1', 'S1'], total: 1 };
  const f = (n, label, v, type = 'text', extra = '') => `<label>${label}<input id="${n}" type="${type}" value="${esc(v)}" ${extra}></label>`;
  openModal(`<h2>${id ? 'Edit book' : 'Add book'}</h2><form onsubmit="saveBook(event,'${id || ''}')">
  ${f('bT', 'Title', b.title, 'text', 'required')}${f('bA', 'Author', b.author, 'text', 'required')}
  <div class="two">${f('bC', 'Category', b.category)}${f('bI', 'ISBN', b.isbn, 'text', 'required')}${f('bN', 'Copies', b.total, 'number', 'min="1" required')}${f('bY', 'Year', b.year, 'number')}</div>
  <label>Description<textarea id="bD" rows="2">${esc(b.descr)}</textarea></label>
  <div class="two">${['Building', 'Floor', 'Wing', 'Rack', 'Shelf'].map((n, i) => f('bL' + i, n, b.location[i])).join('')}</div>
  <div class="acts"><button class="btn" type="submit">Save book</button><button class="btn alt" type="button" onclick="closeModal()">Cancel</button></div></form>`);
}
function saveBook(e, id) {
  e.preventDefault();
  const body = { title: $('#bT').value.trim(), author: $('#bA').value.trim(), category: $('#bC').value.trim(), isbn: $('#bI').value.trim(), total: +$('#bN').value, year: +$('#bY').value, descr: $('#bD').value.trim(), loc: [0, 1, 2, 3, 4].map((i) => $('#bL' + i).value.trim().replace('|', '')).join('|') };
  run(async () => { await api(id ? '/books/' + id : '/books', id ? 'PUT' : 'POST', body); closeModal(); }, id ? 'Book updated.' : 'Book added.');
}
const delBook = (id) => confirm('Delete this book and its history?') && run(() => api('/books/' + id, 'DELETE'), 'Book deleted.');
function issueView() {
  $('#content').innerHTML = `<div class="card"><h2>Issue a book</h2><div class="two"><label>Student<select id="iu">${D.users.map((u) => `<option value="${u.id}">${esc(u.name)}${u.roll ? ' (' + esc(u.roll) + ')' : ''}</option>`).join('')}</select></label>
  <label>Book<select id="ib">${D.books.map((b) => `<option value="${b.id}">${esc(b.title)} (${b.available} free)</option>`).join('')}</select></label></div>
  <button class="btn" onclick="issueBook()">Issue book</button></div>
  <div class="card"><h2>Active loans</h2>${table(['Book', 'Student', 'Due', 'Status', ''], open().map((l) => `<tr class="${l.lateDays ? 'late' : ''}"><td>${esc(l.title)}</td><td>${esc(l.student)}</td><td>${fmt(l.due)}</td>
    <td>${l.lateDays ? badge('bad', l.lateDays + ' days late') : badge('ok', 'On time')}</td><td><button class="btn sm" onclick="returnBook('${l.id}')">Return</button></td></tr>`), 'No active loans.')}</div>`;
}
const issueBook = () => run(() => api('/loans', 'POST', { userId: $('#iu').value, bookId: $('#ib').value }), 'Book issued.');
const returnBook = (id) => run(() => api(`/loans/${id}/return`, 'PATCH'), 'Book returned.');
const setRes = (id, status) => run(() => api('/reservations/' + id, 'PATCH', { status }), 'Reservation ' + status + '.');
function resLib() {
  const next = { pending: ['approved', 'Approve'], approved: ['ready', 'Mark ready'], ready: ['collected', 'Complete pickup'] };
  $('#content').innerHTML = `<div class="card">${table(['Book', 'Student', 'Requested', 'Status', ''], D.res.map((r) => `<tr><td>${esc(r.title)}</td><td>${esc(r.student)}</td><td>${fmt(r.created)}</td><td>${resBadge(r.status)}${r.status === 'ready' ? ' by ' + fmt(r.expires) : ''}</td>
    <td class="acts">${next[r.status] ? `<button class="btn sm" onclick="setRes('${r.id}','${next[r.status][0]}')">${next[r.status][1]}</button><button class="btn alt sm" onclick="setRes('${r.id}','cancelled')">Cancel</button>` : ''}</td></tr>`), 'No reservations yet.')}</div>`;
}
function finesLib() {
  const rows = D.loans.filter((l) => l.fine > 0);
  $('#content').innerHTML = `<div class="card">${table(['Student', 'Book', 'Late days', 'Fine', ''], rows.map((l) => `<tr><td>${esc(l.student)}</td><td>${esc(l.title)}</td><td>${l.lateDays}</td><td>Rs ${l.fine}</td>
    <td>${l.paid ? badge('ok', 'Paid') : l.returned ? `<button class="btn sm" onclick="payFine('${l.id}')">Mark paid</button>` : badge('warn', 'Not returned yet')}</td></tr>`), 'No fines recorded.')}</div>`;
}
const payFine = (id) => run(() => api(`/loans/${id}/pay`, 'PATCH'), 'Fine marked as paid.');

const VIEWS = {
  student: { dash: dashStudent, cat: catalogue, loans: loansStudent, res: resStudent, fines: finesStudent, notes: notesView },
  librarian: { dash: dashLib, books: booksLib, issue: issueView, res: resLib, fines: finesLib },
};

// ---------- Start: restore session if the token is still valid ----------
if (localStorage.getItem('hl_token')) start().catch(() => logout());
