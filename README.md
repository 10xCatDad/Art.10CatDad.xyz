# 10xCatDad // ART & STUFF

A public gallery for art and visual experiments, built for ChatGPT Sites.

- Responsive image grid with two thumbnail sizes
- Search across titles, descriptions, and tags; newest, oldest, and title sorting
- Full-image viewer, arrow-key navigation, share links, and downloads
- System, light, and dark themes, saved per device
- Owner-only batch uploads, editing, and deletion
- Persistent D1 metadata and R2 images, separate from Git

## Using the gallery

Browse at `https://art.10xcatdad.xyz`. To add art, open `/manage` and sign in with the owning ChatGPT account. Drop images onto the page or choose multiple files. Each successful upload appears publicly immediately. Click the pencil to add a title, description, or comma-separated tags.

Use **Log out** in the header to return to the public gallery without owner controls.

Uploads accept JPG, PNG, and WebP, up to 100 MiB per file and 100 megapixels. These are application limits. The browser re-encodes the image at its original dimensions and makes a small preview. The server validates the original image as a stream and rejects any remaining embedded metadata. Uploads use 8 MiB parts with retries and progress, keeping each request small. Images become visible only after all parts and the preview pass validation. Abandoned uploads expire after 24 hours and are cleaned during subsequent uploads. Uploaded filenames are not published. Titles start as “Untitled.” JPEG and WebP copies may be recompressed. Keep your source artwork separately.

Only upload images whose visible content you want to publish. Metadata removal does not remove text or identifying content drawn into an image. Titles, descriptions, and tags are public.

## Suggested tags

Open an image's edit dialog and choose **Generate tags**. Suggestions are added to the Tags field alongside existing tags, without duplicates. Review them and choose **Save changes** to publish. Closing the dialog leaves the image unchanged. There are at most 12 tags per image.

Tag generation uses a private worker on the owner's computer and its existing Codex subscription sign-in. No OpenAI API key is required. The computer, its Linux environment, and the worker must be running; otherwise the gallery reports that tagging is offline. Cached suggestions can still be reused. Generation uses subscription usage and depends on the current Codex subscription transport.

The worker downloads only a published thumbnail, requests structured image tags with tools disabled, and returns suggestions through an authenticated endpoint. It does not send account details to the gallery. The public browser never receives worker credentials or Codex tokens. Suggestions remain private until the owner saves them.

For a local worker, install Node.js 22.13+ and Codex, then sign in through Codex's native login. Store a random 32-byte-or-longer `TAGGER_TOKEN` in a private environment file and the same value as a Sites runtime secret. Set `ART_SITE_ORIGIN=https://art.10xcatdad.xyz` in that environment file. Never commit these values. `ART_TAGGER_MODEL` optionally overrides the default `gpt-6-luna` model. Run `scripts/codex-tagger.mjs` with those environment variables, or adapt `ops/art-tagger.service` for a systemd user service. Redeploy the site after changing its runtime secret.


## Local development

Use Node.js 22.13 or newer.

```sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_high_kitty_pryde.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_mean_tony_stark.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_amused_ezekiel.sql
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

To include tag-queue and logout integration checks, set a local-only `TAGGER_TOKEN` in `.dev.vars` and run `node --env-file=.dev.vars node_modules/@playwright/test/cli.js test`. The test simulates the private worker response without invoking Codex. `ART_TEST_ORIGIN` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE` optionally select a different local port and installed Chromium.

## Hosting and identity

`.openai/hosting.json` preserves the registered Sites project and its `DB` / `BUCKET` bindings. Publish through the Sites plugin's source synchronization, packaging, and deployment workflow. Push the exact tested source to GitHub as 10xCatDad as well.

Set the production `OWNER_EMAIL` as a secret in Sites. The first matching platform-authenticated owner sign-in pins the Site-specific user ID in D1. Later authorization compares that stable ID. No visitor can claim the gallery just by signing in. Do not put the owner email in source, browser code, Git, or public metadata. After the ID is pinned, the bootstrap email secret can be removed. Upload, edit, and delete endpoints require owner identity and a matching request Origin.

The gallery is public; management requires ChatGPT sign-in. Custom domains require the exact DNS records issued by Sites. Runtime secrets, local credentials, uploaded images, databases, and build output are excluded from Git. See `AGENTS.md` for project identity and authorship requirements.

## Storage

Sites currently documents no fixed per-Site file-storage limit and a 10 GB per-Site database limit. Plan allowances and future usage charges are separate from those limits: https://learn.chatgpt.com/docs/sites#pricing.
