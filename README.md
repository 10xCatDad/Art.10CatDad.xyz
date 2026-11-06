# 10xcatdad Art

A simple public gallery for AI art, built for ChatGPT Sites.

- Responsive image grid with two thumbnail sizes
- Search across titles, descriptions, and tags; newest, oldest, and title sorting
- Full-image viewer, arrow-key navigation, share links, and downloads
- System, light, and dark themes, saved per device
- Owner-only batch uploads, editing, and deletion
- Persistent D1 metadata and R2 images, separate from Git

## Using the gallery

Browse at `https://art.10xcatdad.xyz`. To add art, open `/manage` and sign in with the owning ChatGPT account. Drop images onto the page or choose multiple files. Each successful upload appears publicly immediately. Click the pencil to add a title, description, or comma-separated tags.

Uploads accept JPG, PNG, and WebP, up to 100 MiB per file and 100 megapixels. These are application limits. The browser re-encodes the image at its original dimensions and makes a small preview. The server validates the original image as a stream and rejects any remaining embedded metadata. Uploads use 8 MiB parts with retries and progress, keeping each request small. Images become visible only after all parts and the preview pass validation. Abandoned uploads expire after 24 hours and are cleaned during subsequent uploads. Uploaded filenames are not published. Titles start as “Untitled.” JPEG and WebP copies may be recompressed. Keep your source artwork separately.

Only upload images whose visible content you want to publish. Metadata removal does not remove text or identifying content drawn into an image. Titles, descriptions, and tags are public.

## Local development

Use Node.js 22.13 or newer.

```sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_high_kitty_pryde.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_mean_tony_stark.sql
```

Create the ignored `.dev.vars` file with `OWNER_EMAIL=seedy@sites.test`, then run:

```sh
npm run dev -- --port 5187 --hostname 127.0.0.1
```

Visit `/signin-with-chatgpt?return_to=/manage` to use the starter's local-only identity simulation. This simulation is absent from production builds. Local data does not sync to the hosted gallery.

## Validation

```sh
npm run typecheck
npm test
npm run test:browser
npm run build
```

Browser tests require the development server above, a clean local gallery, and Playwright Chromium. Run `npx playwright install chromium` if needed. Tests cover anonymous write rejection, cross-origin rejection, PNG/WebP/JPEG uploads, metadata removal, size limits, failed-upload cleanup, and a real PNG over 99 MiB through both the chunk API and browser file picker. They also cover editing, search, reload persistence, the viewer, themes, mobile layout, and deletion. Test artwork stays local and is removed after the successful test. Screenshots and test output live in ignored `outputs/`.

## Hosting and identity

`.openai/hosting.json` preserves the registered Sites project and its `DB` / `BUCKET` bindings. Publish through the Sites plugin's source synchronization, packaging, and deployment workflow. Push the exact tested source to GitHub as 10xCatDad as well.

Set the production `OWNER_EMAIL` as a secret in Sites. The first matching platform-authenticated owner sign-in pins the Site-specific user ID in D1. Later authorization compares that stable ID. No visitor can claim the gallery just by signing in. Do not put the owner email in source, browser code, Git, or public metadata. After the ID is pinned, the bootstrap email secret can be removed. Upload, edit, and delete endpoints require owner identity and a matching request Origin.

The gallery is public; management requires ChatGPT sign-in. Custom domains require the exact DNS records issued by Sites. Runtime secrets, local credentials, uploaded images, databases, and build output are excluded from Git. See `AGENTS.md` for project identity and authorship requirements.

## Storage

Sites currently documents no fixed per-Site file-storage limit and a 10 GB per-Site database limit. Plan allowances and future usage charges are separate from those limits: https://learn.chatgpt.com/docs/sites#pricing.
