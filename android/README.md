# Art Manager for Android

An owner companion for art.10xCatDad.xyz. Kotlin and Jetpack Compose, Android 9 or newer.

Download the signed APK from this repository's [Releases](https://github.com/10xCatDad/Art.10CatDad.xyz/releases). APKs are release assets, not Git blobs. No account credentials are included in the APK.

## Connect

1. Install the APK and tap **OPEN DEVICE SETUP**.
2. In your browser, sign in as the gallery owner at `https://art.10xcatdad.xyz/manage/devices`.
3. Create a device key, copy it, and paste it into the app. Tap **CONNECT**.

Keys expire after 90 days. Revoke a key from the Devices page, or use **DISCONNECT THIS DEVICE** in the app. Android keeps the key encrypted using Android Keystore, excludes app data from backups and device transfer, and does not send the key on public image requests. The server stores only its SHA-256 digest. Device keys cannot create or revoke other device keys, run the tag worker, or upload CAPTCHA results.

## First release

- Search and sort your media, load more results, and inspect previews.
- Edit titles, descriptions, and tags; request and review tag suggestions from the existing worker.
- Delete an image after confirmation, or copy its public link.
- Choose multiple images with the Android document picker, or share images from another app to Art Manager.
- Review a persistent local inbox before publishing. Uploads are sequential, show per-image progress, and retry interrupted work only when requested.
- Choose System, Light, or Dark appearance.

Uploads publish immediately after confirmation. Metadata is removed by decoding and re-encoding pixels; orientation is retained. Transparent images become PNG and opaque images become JPEG. Previews become WebP. Titles start as Untitled, and source filenames stay local. Retain your originals separately.

The Android uploader accepts still JPG, PNG, and WebP images up to 24 megapixels and 100 MiB each, with 10 pending files and a 250 MiB inbox limit. Use the web uploader for larger images. Keep the app open while uploading. There is no background service in v0.1.0. If Android stops the process, retry from the saved inbox; the app checks the previous upload ID before creating another image. There is no offline editing or video support. Device keys control gallery media, not unlisted CAPTCHA result storage.

## Build

Use JDK 17 and Android SDK 36. Set `ANDROID_HOME` or add an ignored `local.properties` containing `sdk.dir`.

```sh
cd android
./gradlew testDebugUnitTest lintDebug assembleDebug assembleDebugAndroidTest
```

Debug builds have a separate application ID and a checkout-local debug signing key. Release package: `xyz.catdad.artmanager`. Keep its release signing key for all future updates and increase `versionCode`.

For a signed release, set `ART_ANDROID_SIGNING_PROPERTIES` to a private file outside the checkout:

```properties
storeFile=art-manager-release.jks
storePassword=YOUR_PRIVATE_PASSWORD
keyAlias=art-manager
keyPassword=YOUR_PRIVATE_PASSWORD
```

`storeFile` is relative to that properties file. Never commit either file.

```sh
./gradlew testDebugUnitTest lintRelease assembleRelease
```

Without signing configuration, the release APK is unsigned and is not ready for installation. Publish the signed release APK with `SHA256SUMS.txt` under an `android-vX.Y.Z` GitHub Release, using the exact committed source. CI checks the app and retains a separate debug APK artifact.

## Verification

JVM tests cover redirect credential isolation, query encoding, recovery after a lost completion response, and avoiding duplicate publication after interruption. The web companion integration test covers owner key creation, scoped access, native uploads and edits, and revocation.

Android device tests cover encrypted key storage, metadata removal with EXIF orientation, and sharing through upload, edit, delete, and disconnect against a disposable local gallery. Build the test app with `-PartTestSite=http://127.0.0.1:5188`, forward that port with `adb reverse tcp:5188 tcp:5188`, and pass a local-only device key as the instrumentation `deviceKey` argument. The override is debug-only; release builds always use the production HTTPS origin. Never run destructive fixture tests against production.

Space Grotesk is bundled with its SIL Open Font License in `app/src/main/assets/SpaceGrotesk-OFL.txt`.
