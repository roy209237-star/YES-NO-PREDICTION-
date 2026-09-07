# YES/NO Pro — Virtual Points

A GitHub-ready Probo-inspired YES/NO prediction demo. **Virtual points only**: no real-money deposits, withdrawals or cash payouts.

## Included
- Register / Login with bcrypt + JWT cookie
- Mobile number + OTP login flow (demo-ready; SMS provider hook)
- PostgreSQL database
- Virtual points wallet + ledger
- YES / NO prediction flow
- One prediction per user per market
- Prediction history
- Leaderboard
- Admin dashboard
- Create / close / resolve markets
- Realtime market refresh with Socket.IO
- Optional Redis Socket.IO adapter for horizontal scaling
- Helmet + rate limiting
- Mobile responsive UI

## Local setup

### 1. Requirements
Node.js 20+ and PostgreSQL 14+.

### 2. Database
Create a database named `yesno_pro`, then run:

```bash
psql -d yesno_pro -f schema.sql
```

### 3. Environment
Copy `.env.example` to `.env` and set `DATABASE_URL` and a strong `JWT_SECRET`.

### 4. Install and seed
```bash
npm install
npm run seed
npm start
```

Open `http://localhost:3000`.

Demo accounts:
- Admin: `admin@example.com` / `Admin@12345`
- User: `user@example.com` / `User@12345`

Change/delete demo credentials before any public deployment.

## Docker PostgreSQL quick start

```bash
docker run --name yesno-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=yesno_pro -p 5432:5432 -d postgres:16
```

Then use:
`postgresql://postgres:postgres@localhost:5432/yesno_pro`

## Scaling toward very large traffic

This repository is an application starter, **not a claim that one server can handle 5 million concurrent users**.

For high-scale production, use:
- CDN + load balancer
- multiple stateless Node.js instances
- Redis adapter/pub-sub for Socket.IO fanout
- PostgreSQL primary + read replicas
- connection pooling (PgBouncer)
- partitioning/archiving for high-volume prediction/ledger tables
- background workers for settlement and scheduled jobs
- observability, autoscaling and load tests
- bot protection and stricter per-route rate limits

The code already supports an optional `REDIS_URL` for the Socket.IO adapter.

## Important
This project intentionally uses virtual points only. Add real-money functionality only after obtaining professional legal/compliance advice and appropriate licensing for the target jurisdiction.

### Mobile OTP
The project includes `/api/auth/request-otp` and `/api/auth/verify-otp`. In this starter, the OTP is printed to the Node server console so you can test the full flow without an SMS bill. For production, replace that section with a verified SMS provider and never expose OTPs in API responses.
