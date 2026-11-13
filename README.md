# Port A Boat Rentals: Booking & Operations

Online booking, contracts, payments, deposits, and dock operations for Port A Boat Rentals. It does the same job as Storable or Peek Pro, but you own it.

## What it does

**For customers** (`/book`, or embedded on portaboatrentals.com)
- Live availability by date, party size, boat, and package (half day, full day, sunset…), with weekend pricing
- Add-ons (Mega Chill, paddle boards, coolers) with inventory limits, so you can't oversell 6 paddle boards
- E-signature on the Rental Agreement (name, DOB, Texas boater-ed card #, drawn signature)
- Secure payment through Stripe Checkout. The card is saved for the security deposit.
- A shareable **passenger waiver link** so every guest can sign from their own phone
- A self-serve booking page with free cancellation and automatic refund inside your cancellation window

**For staff** (`/admin`)
- **Today**: departures, who's on the water, overdue returns, and missing signatures or payments or deposits at a glance
- **Calendar**: day timeline, week grid, and month view per boat. Block off time for maintenance, weather, or owner use.
- **Check-out**: before photos from your phone, fuel and engine hours, and a deposit hold. It's blocked until the agreement is signed and the balance is paid.
- **Check-in**: after and damage photos, fuel and engine hours, damage notes
- **Deposit**: release in full, or capture part or all of it with a reason (the rest is released automatically)
- Refunds, cash and terminal payments, rescheduling, swapping boats, cancelling, and phone bookings with a "send pay link" option
- **Fleet**: boats, rates, deposits, registration and HIN, engine hours, maintenance log
- **Contracts**: versioned. Every signature stores the exact text signed, a SHA-256 hash, IP, device, and timestamp.
- **Customers**: history, lifetime spend, damage history, staff notes
- **Reports**: revenue, refunds, damage captures, sales tax, utilization per boat, add-on sales, busiest days
- Roles: **Owner**, **Manager** (refunds and captures), and **Staff** (check-in/out and photos)

## Run it locally

```bash
npm install
cp .env.example .env        # defaults work for local testing
npm run setup               # creates the SQLite DB + sample fleet + owner login
npm run dev                 # http://localhost:3000  (admin: /admin)
```

The default login is `admin@portaboatrentals.com` / `change-me`. Change it in `.env` before seeding.

With no `STRIPE_SECRET_KEY`, the app runs in **test payment mode**. Every payment, hold, capture, and refund is recorded, but no card is charged.

`npm test` runs the scheduling, time zone, and pricing tests.

## Going live (checklist)

1. **Database**: create a Postgres database (Neon, Supabase, or Render). In `prisma/schema.prisma`, set `provider = "postgresql"`, set `DATABASE_URL`, then run `npx prisma db push && npm run db:seed`.
2. **Hosting**: Vercel, Render, or Railway. Set every variable from `.env.example`. Set `APP_URL` to the public URL and set `SESSION_SECRET` to `openssl rand -hex 32`.
3. **Photos**: on serverless hosts (Vercel), set `STORAGE_DRIVER=s3` and use a private bucket. Cloudflare R2 is cheap and has no egress fees.
4. **Stripe**:
   - Add `STRIPE_SECRET_KEY`.
   - Create a webhook to `https://YOUR-APP/api/stripe/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `charge.dispute.created`.
   - Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
5. **Scheduled job**: call `GET /api/cron` with header `Authorization: Bearer $CRON_SECRET` every 15–30 minutes. It releases abandoned unpaid holds and places deposit holds about 24 hours before each trip. Card holds only last about 7 days, which is why the hold isn't placed at booking time.
6. **Email**: set SMTP credentials (Google Workspace, Postmark, SES…) and `STAFF_NOTIFY_EMAIL` for new-booking alerts.
7. **Your real data**: in Admin → Fleet, edit the sample tritoons: names, photos, real prices, deposits. Then set tax, hours, buffer, and cancellation policy in Settings.
8. **Contract**: the included agreement is a starting template. **Have a Texas maritime attorney review it** before customers sign it.
9. **Domain and website**:
   - Point a subdomain at the app, for example `book.portaboatrentals.com`. Once Storable is retired, you can use `rentals.portaboatrentals.com`.
   - On WordPress, link "Book Now" buttons to `/book`, or paste the iframe snippet from Admin → Settings.

## Moving off Storable

- Export customers and **future** reservations from Storable.
- Enter future trips as phone bookings (Admin → + Booking → "Paid in full – card terminal / other"). They then block the calendar and show up in operations.
- Run both systems in parallel for a week. Then switch DNS and the website buttons, and close online booking in Storable.

## Tech

Next.js 15 (App Router, server actions) · Prisma (SQLite for dev, Postgres for prod) · Stripe · Tailwind · S3-compatible storage · Nodemailer. All times are stored in UTC and shown in `BUSINESS_TZ` (America/Chicago).

Key code:
- `src/lib/availability.ts`: slot and overlap logic, with turnaround buffer and add-on inventory
- `src/lib/bookings.ts`: booking creation (with an in-transaction double-booking check) and lifecycle
- `src/lib/payments.ts`: Stripe Checkout, saved card, deposit hold/capture/release, refunds, and mock mode
- `src/app/admin/actions.ts`: all staff operations
