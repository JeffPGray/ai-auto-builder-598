This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## `vercel.json` — do not delete it

This template is a **static export** (`output: 'export'`) deployed with `vercel deploy --prebuilt`.
With Next 16 + Vercel CLI 59, `vercel build` writes an `overrides` entry into
`.vercel/output/config.json` that re-homes `index.html` onto the serving path `index`. On a
prebuilt deploy nothing then maps `/` onto it, so the site answers **404 at `/`** while `/index`,
every subpage and every asset answer 200. Verified by deploy on 2026-08-15.

`vercel.json` restores it with one rewrite (`/` → `/index`), which `vercel build` places
immediately after the `filesystem` handler. Removing the file re-breaks the homepage silently —
and the homepage URL is the one that goes into outreach.

Note it is **only** correct for the static export. The `/cms` retrofit turns the site into a
server app, where `/index` is not a route; that skill deletes this file as part of the flip.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
