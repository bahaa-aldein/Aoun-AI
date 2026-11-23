# Aoun AI

A full-stack SaaS platform for building, training, and deploying AI-powered chatbots. Businesses can create intelligent conversational agents, embed them on their websites, connect them to messaging platforms, and manage everything from a single dashboard.

---

## Features

- **Knowledge-based AI** — train bots on uploaded documents, PDFs, or crawled websites using vector embeddings and semantic search
- **Embeddable chat widget** — drop a script tag and your bot is live; supports Arabic RTL and voice capabilities
- **Multi-channel integration** — deploy to websites, WhatsApp, and Facebook Messenger
- **Subscription billing** — Stripe-powered plans with upgrade/downgrade flows and webhook handling
- **Admin dashboard** — analytics, lead management, bot monitoring, and usage metrics
- **Performance** — Redis caching of chatbot responses and generated speech audio, plus database indexing

---

## Tech stack

**Frontend**
Next.js 15 · React 19 · TypeScript · Tailwind CSS · Radix UI · TanStack Query · Framer Motion

**Backend**
Next.js API Routes · Prisma · MongoDB · Upstash Vector · Upstash Redis

**AI/ML**
OpenAI GPT · OpenAI Embeddings API · OpenAI text-to-speech

**Integrations**
Stripe · NextAuth.js · Firebase · Google APIs · Meta APIs · SendPulse

---

## Architecture overview

```
User uploads document
       ↓
Text extraction (PDF, Word, web crawl)
       ↓
Chunking + OpenAI embeddings
       ↓
Stored in Upstash Vector DB
       ↓
User sends chat message
       ↓
Query embedded → vector similarity search
       ↓
Top chunks + chat history sent to GPT
       ↓
Response cached in Redis → returned to user
```

---

## Getting started

### Prerequisites

- Node.js 22
- MongoDB replica set (Atlas works; a standalone `mongod` does not, because Prisma needs transactions)
- Upstash account (Vector + Redis)
- OpenAI API key
- Stripe account

### Installation

```bash
git clone https://github.com/bahaa-aldein/Aoun-AI.git
cd Aoun-AI
npm install
```

### Environment variables

Create a `.env.local` file in the root directory:

```env
# Database
DATABASE_URL=

# Auth
NEXTAUTH_SECRET=
NEXTAUTH_URL=

# OpenAI
OPENAI_API_KEY=

# Upstash
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
UPSTASH_VECTOR_REST_URL=
UPSTASH_VECTOR_REST_TOKEN=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Firebase
FIREBASE_API_KEY=
```

### Database setup

A new, empty database needs its collections created and some starting data.
Run this once per database.

1. Create a MongoDB cluster in a region that is up and close to where the app runs (for Vercel's default region, `us-east-1` or `eu-central-1`). Create a database user and allow network access from Vercel (`0.0.0.0/0`, because Vercel's IP addresses change).
2. Create a `.env` file (not `.env.local`; Prisma and the seed script read `.env`). It is git-ignored. **The connection string must include the database name** (`.../aoun?retryWrites=true`), otherwise MongoDB uses `test`:

   ```env
   DATABASE_URL=
   SEED_ADMIN_EMAIL=
   SEED_ADMIN_PASSWORD=
   ```

3. Create the collections and indexes, then seed:

   ```bash
   npm run db:push
   npm run db:seed
   ```

4. Remove `SEED_ADMIN_PASSWORD` from `.env`.

The seed creates:

- the admin account (`SEED_ADMIN_EMAIL`; signup only ever creates regular users, so this is the only way to get the first admin)
- the English and Arabic site content, from the built-in text in `src/dictionaries`

It is safe to run again: it only creates what is missing and never overwrites anything.
Use `npm run db:seed -- --dry-run` to see what it would do first.

#### Restoring exported data

If you exported collections from MongoDB Compass (files named `<database>.<Collection>.json`), the seed can restore `Plan`, `SiteContent`, `Document` and `Embedding` records with their original ids:

```bash
npm run db:seed -- --from "C:\path\to\JSON Files"
```

- If a collection was exported more than once, the newest file wins per record.
- Only the knowledge base with the most recent documents is restored by default, and it is owned by the admin user. Use `--all-kbs` or `--kb <id>` to restore others.
- Vectors in Upstash are keyed by document id and filtered by knowledge base id, so restoring the same ids reconnects a knowledge base to vectors that are still in Upstash. If the Upstash index was emptied, add `--restore-vectors` to push the exported vectors back (needs `UPSTASH_VECTOR_REST_URL` and `UPSTASH_VECTOR_REST_TOKEN`).
- Files that are not exports of these collections are ignored and never opened. Keep export folders, and especially service-account key files, out of the repository.

#### After seeding

- Log in with the admin account. Review **Admin > Pricing** and **Admin > Content**.
- Stripe: restored plans keep their `stripePriceId`. Check they exist in the Stripe account you are using.
- The first knowledge base in the database is what logged-out visitors get in the home page chat widget, so create or restore the demo knowledge base first. `DEMO_KB_ID` and `NEXT_PUBLIC_DEMO_KB_ID` must be set to its id (a restored knowledge base keeps its original id).
- After moving to a new database, change `NEXTAUTH_SECRET`: sessions are JWTs that contain user ids from the old database.

### Run locally

```bash
npm run dev
```

Open http://localhost:3000
