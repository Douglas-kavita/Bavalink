# Bavalink

A responsive tools and equipment catalogue for the Kenyan market.

## Refresh the catalogue

Run `npm run refresh-catalog` to update the bundled product data from the source catalogue.

## Deploy

The project is configured for Vercel. Its public output directory is `dist`.

## Admin dashboard

After deployment, open `/admin` to edit the website wording, contact details, homepage images, colours, section visibility, categories, products, prices and stock.

Add these private environment variables in **Vercel → Project Settings → Environment Variables**, then redeploy:

- `BAVALINK_ADMIN_PASSWORD` — the password used to sign in to the dashboard
- `BAVALINK_SESSION_SECRET` — a long random value used to secure admin sessions
- `GITHUB_TOKEN` — a fine-grained GitHub token limited to the `Bavalink` repository with **Contents: Read and write** permission

Optional variables:

- `GITHUB_REPO` — defaults to `Douglas-kavita/Bavalink`
- `GITHUB_BRANCH` — defaults to `main`

Publishing from the dashboard commits the updated configuration and catalogue to GitHub. Vercel then redeploys the website automatically.
