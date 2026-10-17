# Debate Card Generator

This project is a Next.js app for cutting debate cards from web evidence.

It lets you:

- enter affirmative contentions, negative contentions, and support targets
- search for source material or deep-cut a single URL
- generate cards with citations and highlighted evidence
- enforce that tags match the evidence and that attack cards refute the contention overall

## Requirements

- Node.js 20+
- npm
- a Groq/OpenAI-compatible API key set as `GROQ_API_KEY`

Create a `.env.local` file in the project root with:

```bash
GROQ_API_KEY=your_key_here
```

The article card cutter can discover sources from a topic and claim focus before cutting cards. It uses the app's source-search fallback chain and does not require a separate search API key.

## Run Locally

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

If PowerShell blocks `npm.ps1`, use:

```bash
npm.cmd run dev
```

The same applies to lint/build commands:

```bash
npm.cmd run lint
npm.cmd run build
```

## Main Files To Open

If you are changing the app, these are the most important files:

- `src/components/DebateForm.tsx`
  Main UI, target input handling, article batching, rerolls, and client-side generation flow.
- `src/components/Card.tsx`
  Card display and copy-to-clipboard formatting.
- `src/app/api/generate/route.ts`
  Core debate card generation logic, source scraping for batches, evidence validation, tag alignment checks, and anti-contention filtering.
- `src/app/api/search/route.ts`
  DuckDuckGo search route that builds the article pool.
- `src/app/api/scrape/route.ts`
  Full-page scraping route for single-URL deep cuts.
- `src/app/page.tsx`
  Home page entry point that renders the form.
- `src/app/layout.tsx`
  Root layout for the app shell.
- `src/app/globals.css`
  Global styling for the UI and card rendering.
- `next.config.ts`
  Next.js configuration, including the Turbopack root setting for this workspace.

## Card Quality Rules

The generator is now designed to enforce these rules:

- tags should only say what the highlighted evidence actually proves
- quoted evidence must come from the scraped source text
- attack cards should go against the contention as a whole, not just a random side point
- weak, tangential, or self-contradictory cards should be filtered out before they reach the UI

## Available Scripts

```bash
npm run dev
npm run lint
npm run build
npm run start
```

## Notes

- `build` may fail in restricted environments if the sandbox blocks child process spawning.
- The app uses server routes in `src/app/api/*` for search, scrape, and generation.
- The search path and generation path are intentionally separate so you can test deep-cut URL mode independently from article search mode.
