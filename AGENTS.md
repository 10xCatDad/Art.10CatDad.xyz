# Project identity

Use only the 10xCatDad GitHub account for this project. Verify authentication and repository access before any remote write. Git author and committer must be 10xCatDad with 353330524+10xCatDad@users.noreply.github.com. Disable inherited signing and unrelated credential helpers. Do not include other identities, private owner details, local filesystem paths, or unrelated profile links in source, history, artifacts, or public content.

Keep runtime secrets in the hosting provider's secret store. Add a Co-authored-by trailer for the verified primary AI model, version, and reasoning effort when it materially authors a commit. Keep image uploads outside Git and strip embedded metadata from published images.

# Visual style

Always spell the brand `10xCatDad` in visible text and metadata. The gallery heading is `ART & STUFF`. Keep the public heading free of a collection subtitle. The footer links the X logo and `10xCatDad` to the public X profile, without an art label. Provide a native logout link for signed-in visitors that returns to the public gallery.

Use self-hosted Space Grotesk, black surfaces with restrained neon-green accents in dark mode, and neutral light surfaces. Theme controls use accessible System, Light, and Dark icons; preserve the visitor's explicit choice and otherwise follow the system, falling back to dark. Primary action buttons use uppercase text. Prefer `//` for decorative separators in headings, branding, and compact labels. Keep text short and the artwork visually dominant.

# Unlisted CAPTCHA results

Keep CAPTCHA result images under the separate `results/` storage prefix without gallery rows, tags, search entries, counts, or Git files. Uploads require a dedicated server-to-server RESULT_IMAGE_TOKEN, distinct from owner and tagger credentials. Accept only bounded, validated PNGs; strip all embedded metadata on the server. IDs are random and opaque, and writes are immutable and idempotent. Public share pages and images require no login so X can fetch their Open Graph and summary_large_image metadata. Label them unlisted and accessible to anyone with the link; use noindex and no-referrer. Never describe them as private or guarantee an X preview.
