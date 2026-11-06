# Android companion

Use the project identity and authorship requirements in the root AGENTS.md. Keep source, history, signing certificates, and artifacts scoped to this project's account. Do not include owner credentials, personal paths, or unrelated identities.

This is an owner management app. Require a verified device connection before media management. Keep release requests on the fixed production HTTPS origin and never forward credentials across redirects. Browser owner identity alone controls device issuance and revocation. Preserve separate permissions for tagger and CAPTCHA result services.

Keep the release signing key outside Git. Preserve the certificate and application ID for upgrades, and increase versionCode. Release APKs and checksums belong in GitHub Releases on this same repository. Debug and test APKs must not be presented as production releases.

For changes, run the relevant JVM tests, Android lint, and builds. Upload, authentication, or persistence changes also need device checks against a disposable local gallery. Never run destructive tests against production artwork. Do not claim physical-device validation based on emulator results.

Preserve explicit upload and delete confirmation. Keep local inbox entries until publication is confirmed, and check an interrupted upload's ID before retrying. Do not log keys or embed source filenames or metadata in public uploads.
