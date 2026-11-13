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
- **Fees**: mandatory fees by trip length (e.g. Damage Waiver $50 for 4 hrs, $100 for 9 hrs), fees included in the boat price and shown separately (e.g. Fuel), and a card convenience fee (percent + flat) on online card payments
- **Messages**: two-way texting with guests through your Quo number, one-tap templates (waiver link, reminder, boat ready), automatic confirmation and day-before texts
- **Maintenance**: service intervals per boat by engine hours and/or days with due alerts, full log per boat and for equipment, damage history per boat
- Roles: **Owner**, **Manager** (refunds and captures), **Staff** (check-in/out and photos), and **Dock crew** (dock app only)

**Customers, marketing & reputation**
- CRM: tags, how they found us, promotion opt-in (checkbox at booking), text/email opt-outs (STOP honored), full message history
- Campaigns: automated pre-arrival, day-of, thank-you + review request, win-back; one-time promotions to filtered groups; merge tags; test sends
- Reviews: Google and Facebook rating, count and trend, recent reviews (needs GOOGLE_PLACES_API_KEY / FACEBOOK_PAGE_ACCESS_TOKEN)

**Money**
- Expenses pulled from Xero (or typed / CSV), mapped to cost types and boats
- Gross profit per booking and per boat, using actual Xero costs when present and your cost assumptions otherwise; breakeven trips per boat per month
- Monthly goals and budget, actual vs goal, and a 3-month forecast

**Crew**
- Weekly schedule, time off, clock in/out, hours & overtime, tips (online at booking, at the dock, post-trip text link) split evenly across the trip's crew, CSV for Gusto payroll

**Safety & paperwork**
- Incident reports from crew (dock app) and guests (link on their booking page), with photos, alerts and TPWD/insurer reminders
- Insurance policies (with document upload and expiry alerts) and tow company info per boat; crew get a one-tap "Call tow" button

**Phone bookings (Quo AI)**
- Calls answered by Quo's AI become booking requests; staff review, approve, and the guest is texted a link to sign and pay

**Roles**: Admin (owner), Manager, Accounting, Office (staff), Crew (dock) — each sees only their areas.

**For the dock crew** (`/dock`, phone-first)
- Today's departures, boats on the water (overdue in red), and returns
- Guided check-out: agreement/payment/waiver checks, 8 guided photos (bow, sides, stern, helm, seating, engine, prop), engine hours, fuel, deposit hold
- Guided check-in: after photos, engine hours, damage log, notes for the office
- **Automatic damage check**: every photo is reviewed by Claude. Check-out photos flag existing damage to document; check-in photos are compared with the matching check-out photo and possible new damage is flagged on screen (and texted to the damage alert phone). The crew confirms or dismisses each spot before check-in. Nothing is charged automatically.
- Boats: service due, mark service done, report issues, damage on record

## Run it locally

```bash
npm install
cp .env.example .env        # defaults work for local testing
npm run setup               # creates the SQLite DB + sample fleet + owner login
                            # (or `npm run setup:demo` to also add sample bookings)
npm run dev                 # http://localhost:3000  (admin: /admin)
```

The default login is `admin@portaboatrentals.com` / `change-me`. Change it in `.env` before seeding. Add dock crew logins in Admin → Settings → Staff logins with the **Dock crew** role; they sign in at `/dock`.

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
6. **Texting (Quo)**: in Quo, create an API key and find your phone number ID (starts with `PN`). Set `QUO_API_KEY` and `QUO_PHONE_NUMBER_ID`. Create a webhook to `https://YOUR-APP/api/quo/webhook` for `message.received`, `message.delivered`, `message.failed`, `message.undelivered`, `call.summary.completed`, `call.transcript.completed` (the call events power AI phone booking requests), and put its `whsec_…` key in `QUO_WEBHOOK_SECRET`.
7. **Xero**: create an app at developer.xero.com (Web app), set `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET`, add the redirect URI shown on Admin → Money → Expenses & Xero, then click Connect.
8. **Reviews**: `GOOGLE_PLACES_API_KEY` (Google Cloud, Places API (New)) and `FACEBOOK_PAGE_ACCESS_TOKEN`; set your Place ID and review links on Admin → Reviews.
9. **Photo damage check & phone AI**: set `ANTHROPIC_API_KEY` (console.anthropic.com). Each check-out/check-in photo is one request, roughly a few cents each.
10. **Email**: set SMTP credentials (Google Workspace, Postmark, SES…) and `STAFF_NOTIFY_EMAIL` for new-booking alerts.
11. **Your real data**: in Admin → Fleet, edit the sample tritoons: names, photos, real prices, deposits. Then set tax, hours, buffer, and cancellation policy in Settings.
12. **Contract**: the included agreement is a starting template. **Have a Texas maritime attorney review it** before customers sign it.
13. **Domain and website**:
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
