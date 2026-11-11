# Aoun AI

A full-stack SaaS platform for building, training, and deploying AI-powered chatbots. Businesses can create intelligent conversational agents, embed them on their websites, connect them to messaging platforms, and manage everything from a single dashboard.

🔗 **Live demo**: https://aoun-ai.vercel.app

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

- Node.js 18+
- MongoDB instance (local or Atlas)
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

### Run locally

```bash
npm run dev
```

Open http://localhost:3000
