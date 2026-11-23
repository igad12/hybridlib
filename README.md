# Hybrid Library (Express + SQLite)

A real client-server version of Hybrid Library. Business rules from `store.js`/`app.js`
now run on the server; data lives in a SQLite file (`library.db`) shared by all users.

## Run locally
    npm install
    npm start          # http://localhost:3000

Demo logins: student `student@library.com` / `student123`, librarian `librarian@library.com` / `admin123`.

## What changed vs. the localStorage version
| Before | Now |
|---|---|
| `localStorage` JSON | SQLite tables (users, books, loans, reservations, notes) |
| Plain-text passwords | bcrypt hashes |
| User id in localStorage | Signed JWT, role checked on every request |
| `dailyCheck()` on login | `node-cron` at midnight (+ once at startup) |
| Rules in browser | Rules in `server.js` (RULES object), cannot be tampered with |

## API
POST /api/auth/register, /api/auth/login · GET /api/me
GET/POST /api/books · GET /api/users (librarian)
GET/POST /api/loans · PATCH /api/loans/:id/return|renew|pay
GET/POST /api/reservations · PATCH /api/reservations/:id  {status}
GET /api/notes · POST /api/notes/read

## Deploy (so it works everywhere)
Host on Render/Railway as a Node web service: build `npm install`, start `npm start`,
set env `JWT_SECRET` to a long random string. Free tiers have ephemeral disks, so for
permanent data attach a persistent disk (set `DB_FILE` to its path) or swap SQLite for
MongoDB/PostgreSQL. Netlify alone cannot run this server.
