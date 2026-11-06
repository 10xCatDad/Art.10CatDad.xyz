package xyz.catdad.artmanager

import android.content.ClipData
import android.content.ContentValues
import android.content.Intent
import android.graphics.Bitmap
import android.media.ExifInterface
import android.provider.MediaStore
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Direction
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class CompanionDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val device = UiDevice.getInstance(instrumentation)
    private fun click(text: String) {
        val selector = By.text(text)
        var found = device.wait(Until.findObject(selector), 3000)
        if (found == null) {
            for (attempt in 0..5) {
                device.findObject(By.scrollable(true))?.scroll(Direction.DOWN, 0.7f)
                found = device.wait(Until.findObject(selector), 1000)
                if (found != null) break
            }
        }
        assertNotNull("Missing control: $text", found); found!!.click(); device.waitForIdle()
    }
    @Test fun metadataIsRemovedAndOrientationIsKept() {
        val inbox = MediaInbox(context)
        val draft = Draft(UUID.randomUUID().toString(), "fixture.jpg")
        val source = inbox.file(draft)
        val bitmap = Bitmap.createBitmap(80, 40, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(android.graphics.Color.GREEN)
        source.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 95, it) }; bitmap.recycle()
        ExifInterface(source).apply { setAttribute(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_ROTATE_90.toString()); setAttribute("Artist", "PRIVATE_TEST_METADATA"); saveAttributes() }
        val prepared = inbox.prepare(draft)
        try {
            assertEquals(40, prepared.width); assertEquals(80, prepared.height)
            assertNull(ExifInterface(prepared.original).getAttribute("Artist"))
            assertFalse(String(prepared.original.readBytes(), Charsets.ISO_8859_1).contains("PRIVATE_TEST_METADATA"))
        } finally { source.delete(); prepared.original.delete() }
    }
    @Test fun encryptedKeySurvivesRecreationWithoutPlaintextPreferences() {
        val vault = TokenVault(context)
        val saved = vault.read()
        val fixture = "art_device_" + "c".repeat(64)
        try {
            vault.write(fixture); assertEquals(fixture, TokenVault(context).read())
            val xml = File(context.applicationInfo.dataDir, "shared_prefs/device-vault.xml").readText()
            assertFalse(xml.contains(fixture))
            vault.clear(); assertNull(vault.read())
        } finally { if (saved != null) vault.write(saved) }
    }
    @Test fun nativeShareUploadEditDeleteAndRevocation() {
        val key = InstrumentationRegistry.getArguments().getString("deviceKey") ?: error("Provide a local-test deviceKey")
        require(BuildConfig.SITE_URL.startsWith("http://127.0.0.1:")) { "Run only against the disposable local gallery" }
        val api = ArtApi({ key })
        // Exercise the real JPEG encoder and strict server validator as well as PNG below.
        val inbox = MediaInbox(context)
        val jpeg = Draft(UUID.randomUUID().toString(), "fixture.jpg")
        val pixels = Bitmap.createBitmap(90, 60, Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.BLUE) }
        inbox.file(jpeg).outputStream().use { pixels.compress(Bitmap.CompressFormat.JPEG, 95, it) }; pixels.recycle()
        val prepared = inbox.prepare(jpeg)
        try { val jpegId = api.upload(prepared, null, {}, {}); api.delete(jpegId) }
        finally { prepared.original.delete(); inbox.remove(jpeg) }
        val before = api.list("", "newest").items.map { it.id }.toSet()
        context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
        assertTrue(device.wait(Until.hasObject(By.text("Connect your gallery")), 15000))
        val input = device.wait(Until.findObject(By.clazz("android.widget.EditText")), 5000)
        assertNotNull(input); input.text = key; click("CONNECT")
        assertTrue(device.wait(Until.hasObject(By.desc("Refresh media")), 15000))
        click("Settings")
        device.findObject(By.scrollable(true))?.scroll(Direction.DOWN, 0.8f)
        device.wait(Until.findObject(By.desc("Dark theme")), 3000)!!.click()
        device.waitForIdle()
        android.os.SystemClock.sleep(300)
        device.takeScreenshot(File(context.getExternalFilesDir(null), "settings-dark.png"))
        click("Media")
        val uri = context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, "ArtManager-local-test.png"); put(MediaStore.Images.Media.MIME_TYPE, "image/png")
        })!!
        var published: String? = null
        try {
            val bitmap = Bitmap.createBitmap(320, 200, Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.rgb(57, 255, 136)) }
            context.contentResolver.openOutputStream(uri)!!.use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }; bitmap.recycle()
            context.startActivity(Intent(context, MainActivity::class.java).apply {
                action = Intent.ACTION_SEND; type = "image/png"; putExtra(Intent.EXTRA_STREAM, uri)
                clipData = ClipData.newRawUri("test image", uri)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            })
            assertTrue(device.wait(Until.hasObject(By.text("Ready")), 15000))
            device.takeScreenshot(File(context.getExternalFilesDir(null), "inbox.png"))
            assertEquals(before, api.list("", "newest").items.map { it.id }.toSet())
            click("UPLOAD 1 IMAGE"); click("UPLOAD")
            assertTrue(device.wait(Until.hasObject(By.text("Uploaded")), 30000))
            published = api.list("", "newest").items.first { it.id !in before }.id
            click("Media")
            click("Untitled")
            assertTrue(device.wait(Until.hasObject(By.text("Edit image")), 5000))
            device.takeScreenshot(File(context.getExternalFilesDir(null), "editor.png"))
            val fields = device.findObjects(By.clazz("android.widget.EditText"))
            assertTrue(fields.size >= 2)
            fields[0].text = "Android device test"; fields[1].text = "Edited on Android"
            click("SAVE CHANGES")
            assertTrue(device.wait(Until.hasObject(By.text("Android device test")), 15000))
            device.takeScreenshot(File(context.getExternalFilesDir(null), "media.png"))
            assertEquals("Edited on Android", api.list("Android device test", "newest").items.first().caption)
            click("Android device test"); click("DELETE IMAGE"); click("DELETE")
            assertTrue(device.wait(Until.hasObject(By.text("No media yet. Add images to publish them.")), 15000))
            published = null
            click("Settings"); click("DISCONNECT THIS DEVICE"); click("DISCONNECT")
            assertTrue(device.wait(Until.hasObject(By.text("Connect your gallery")), 10000))
            try { api.session(); fail("Device still authorized") } catch (error: ApiFailure) { assertEquals(401, error.status) }
        } finally {
            context.contentResolver.delete(uri, null, null)
            published?.let { runCatching { api.delete(it) } }
        }
    }
}
