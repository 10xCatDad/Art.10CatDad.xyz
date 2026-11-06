package xyz.catdad.artmanager

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ColorSpace
import android.graphics.ImageDecoder
import android.net.Uri
import android.provider.OpenableColumns
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.util.UUID

data class Draft(val id: String, val name: String, val state: String = "Ready", val progress: Int = 0, val error: String? = null, val uploadId: String? = null)
data class PreparedImage(val original: File, val thumbnail: ByteArray, val mime: String, val width: Int, val height: Int)

class MediaInbox(private val context: Context) {
    private val root = File(context.filesDir, "inbox").apply { mkdirs() }
    private val manifest = AtomicFile(File(root, "queue.json"))
    fun file(draft: Draft) = File(root, "${draft.id}.source")
    fun load(): List<Draft> = runCatching {
        val rows = JSONArray(manifest.openRead().bufferedReader().use { it.readText() })
        (0 until rows.length()).map { index ->
            val row = rows.getJSONObject(index)
            val savedState = row.getString("state")
            Draft(row.getString("id"), row.getString("name"), if (savedState == "Uploading") "Retry" else savedState,
                error = if (savedState == "Uploading") "Upload interrupted. Retry checks whether it already published." else row.optString("error").ifBlank { null },
                uploadId = row.optString("uploadId").ifBlank { null })
        }.filter { ArtApi.imageIdPattern.matches(it.id) && (file(it).isFile || it.state == "Uploaded") }
    }.getOrDefault(emptyList())
    @Synchronized fun save(rows: List<Draft>) {
        val array = JSONArray()
        rows.forEach { array.put(JSONObject().put("id", it.id).put("name", it.name).put("state", it.state).put("error", it.error).put("uploadId", it.uploadId)) }
        val stream = manifest.startWrite()
        try { stream.write(array.toString().toByteArray()); manifest.finishWrite(stream) }
        catch (error: Exception) { manifest.failWrite(stream); throw error }
    }
    fun import(uri: Uri): Draft {
        require(uri.scheme == "content") { "Choose an image from the Android picker or Share menu." }
        val used = root.listFiles()?.filter { it.extension == "source" }?.sumOf { it.length() } ?: 0
        val budget = minOf(100L * 1024 * 1024, 250L * 1024 * 1024 - used)
        if (budget <= 0) throw IOException("The inbox is full. Upload or remove some images first.")
        var name = "Shared image"
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) name = cursor.getString(0)?.filter { it >= ' ' }?.take(120) ?: name
        }
        val draft = Draft(UUID.randomUUID().toString(), name)
        try {
            val input = context.contentResolver.openInputStream(uri) ?: throw IOException("The image could not be opened.")
            input.use { source -> file(draft).outputStream().use { dest ->
                val buffer = ByteArray(65536); var size = 0L
                while (true) { val count = source.read(buffer); if (count < 0) break; size += count
                    if (size > budget) throw IOException("Use files up to 100 MiB and an inbox up to 250 MiB.")
                    dest.write(buffer, 0, count)
                }
            } }
            val info = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file(draft).path, info)
            if (info.outMimeType !in listOf("image/jpeg", "image/png", "image/webp")) throw IOException("Use JPG, PNG, or WebP images.")
            if (info.outWidth <= 0 || info.outHeight <= 0 || info.outWidth.toLong() * info.outHeight > 24_000_000) throw IOException("The Android uploader supports images up to 24 megapixels. Use the website for larger files.")
            return draft
        } catch (error: Exception) { file(draft).delete(); throw error }
    }
    fun remove(draft: Draft) { file(draft).delete() }
    fun prepare(draft: Draft): PreparedImage {
        val output = File(context.cacheDir, "prepared-${draft.id}")
        val bitmap = ImageDecoder.decodeBitmap(ImageDecoder.createSource(file(draft))) { decoder, info, _ ->
            if (info.isAnimated) throw IOException("Animated images are not supported. Export a still image first.")
            if (info.size.width.toLong() * info.size.height > 24_000_000) throw IOException("Use an image up to 24 megapixels.")
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            decoder.setTargetColorSpace(ColorSpace.get(ColorSpace.Named.SRGB))
        }
        try {
            val mime = if (bitmap.hasAlpha()) "image/png" else "image/jpeg"
            val format = if (bitmap.hasAlpha()) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG
            output.outputStream().use { if (!bitmap.compress(format, 97, it)) throw IOException("Could not prepare this image.") }
            EncodedImage.clean(output, mime)
            if (output.length() > 100L * 1024 * 1024) throw IOException("The cleaned image exceeds 100 MiB.")
            val scale = minOf(1.0, 960.0 / maxOf(bitmap.width, bitmap.height))
            val thumb = Bitmap.createScaledBitmap(bitmap, maxOf(1, (bitmap.width * scale).toInt()), maxOf(1, (bitmap.height * scale).toInt()), true)
            val buffer = ByteArrayOutputStream()
            try {
                @Suppress("DEPRECATION")
                if (!thumb.compress(Bitmap.CompressFormat.WEBP, 82, buffer)) throw IOException("Could not prepare the preview.")
            } finally { if (thumb !== bitmap) thumb.recycle() }
            return PreparedImage(output, buffer.toByteArray(), mime, bitmap.width, bitmap.height)
        } catch (error: Exception) { output.delete(); throw error }
        finally { bitmap.recycle() }
    }
}
