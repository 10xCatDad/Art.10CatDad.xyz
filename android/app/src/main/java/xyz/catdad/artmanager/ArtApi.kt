package xyz.catdad.artmanager

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MultipartBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

data class ArtImage(val id: String, val title: String, val caption: String, val tags: String, val width: Int, val height: Int, val bytes: Long) {
    companion object {
        fun parse(json: JSONObject) = ArtImage(json.getString("id"), json.getString("title"), json.optString("caption"), json.optString("tags"), json.getInt("width"), json.getInt("height"), json.getLong("bytes"))
    }
}
data class Listing(val items: List<ArtImage>, val total: Int, val bytes: Long, val nextOffset: Int?)
data class DeviceSession(val name: String, val expiresAt: Long, val taggerOnline: Boolean)
class ApiFailure(val status: Int, message: String) : IOException(message)

class ArtApi(private val token: () -> String?, internal val baseUrl: String = BuildConfig.SITE_URL) {
    companion object {
        val tokenPattern = Regex("art_device_[0-9a-f]{64}")
        val imageIdPattern = Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
        val publicClient = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
            .connectTimeout(15, TimeUnit.SECONDS).readTimeout(45, TimeUnit.SECONDS).writeTimeout(60, TimeUnit.SECONDS)
            .callTimeout(120, TimeUnit.SECONDS).build()
    }
    private val root = baseUrl.trimEnd('/')
    private fun call(path: String, method: String = "GET", body: RequestBody? = null, authenticated: Boolean = true): JSONObject {
        require(path.startsWith("/api/") && !path.contains(".."))
        val builder = Request.Builder().url(root + path).header("Accept", "application/json")
        if (authenticated) builder.header("Authorization", "Bearer " + (token() ?: throw ApiFailure(401, "Connect your device first.")))
        builder.method(method, body)
        publicClient.newCall(builder.build()).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            val json = runCatching { JSONObject(raw) }.getOrElse { JSONObject() }
            if (!response.isSuccessful) {
                val message = if (response.code == 401) "Device access expired or was removed. Connect again in Settings."
                    else if (response.code in 300..399) "The server redirected this request. Open device setup in your browser."
                    else json.optString("error").ifBlank { "The gallery could not complete the request (${response.code})." }
                throw ApiFailure(response.code, message)
            }
            if (raw.isBlank() || json.length() == 0) throw IOException("The gallery returned an unreadable response.")
            return json
        }
    }
    private fun json(value: JSONObject) = value.toString().toRequestBody("application/json".toMediaType())
    fun session(): DeviceSession {
        val result = call("/api/companion/session")
        if (result.getInt("apiVersion") != 1) throw IOException("Update Art Manager to connect to this gallery.")
        val d = result.getJSONObject("device")
        return DeviceSession(d.getString("name"), d.getLong("expires_at"), result.optBoolean("taggerOnline"))
    }
    fun disconnect() { call("/api/companion/session", "DELETE") }
    fun list(query: String, sort: String, offset: Int = 0): Listing {
        val url = okhttp3.HttpUrl.Builder().scheme("https").host("unused.invalid").addPathSegments("api/images")
            .addQueryParameter("q", query).addQueryParameter("sort", sort).addQueryParameter("offset", offset.toString()).build()
        val data = call(url.encodedPath + "?" + url.encodedQuery, authenticated = false)
        val rows = data.getJSONArray("items")
        return Listing((0 until rows.length()).map { ArtImage.parse(rows.getJSONObject(it)) }, data.getInt("total"), data.getLong("bytes"), if (data.isNull("nextOffset")) null else data.getInt("nextOffset"))
    }
    fun save(item: ArtImage) {
        require(imageIdPattern.matches(item.id))
        call("/api/images/${item.id}", "PATCH", json(JSONObject().put("title", item.title).put("caption", item.caption).put("tags", item.tags)))
    }
    fun delete(id: String) { require(imageIdPattern.matches(id)); call("/api/images/$id", "DELETE") }
    fun tags(id: String, start: Boolean): JSONObject {
        require(imageIdPattern.matches(id))
        return call("/api/images/$id/tags", if (start) "POST" else "GET", if (start) ByteArray(0).toRequestBody() else null)
    }
    fun thumbnailUrl(id: String): String { require(imageIdPattern.matches(id)); return "$root/media/$id/thumbnail" }
    fun upload(image: PreparedImage, previousId: String?, onSession: (String) -> Unit, progress: (Int) -> Unit): String {
        if (previousId != null) {
            require(imageIdPattern.matches(previousId))
            if (isPublished(previousId)) return previousId
            // A processing upload cannot be abandoned. Do not risk publishing a duplicate.
            call("/api/uploads/$previousId", "DELETE")
        }
        val session = call("/api/uploads", "POST", json(JSONObject().put("mime", image.mime).put("bytes", image.original.length()).put("width", image.width).put("height", image.height)))
        val id = session.getString("id"); require(imageIdPattern.matches(id))
        onSession(id)
        val chunkSize = session.getInt("partBytes")
        if (chunkSize !in 1..8 * 1024 * 1024) throw IOException("Unsupported upload chunk size.")
        try {
            val parts = JSONArray()
            image.original.inputStream().use { input ->
                var sent = 0L
                while (sent < image.original.length()) {
                    val chunk = ByteArray(minOf(chunkSize.toLong(), image.original.length() - sent).toInt())
                    var filled = 0
                    while (filled < chunk.size) {
                        val count = input.read(chunk, filled, chunk.size - filled)
                        if (count < 0) throw IOException("The prepared image is incomplete.")
                        filled += count
                    }
                    val path = "/api/uploads/$id?part=${parts.length() + 1}"
                    var result: JSONObject? = null
                    for (attempt in 0..2) {
                        try { result = call(path, "PUT", chunk.toRequestBody("application/octet-stream".toMediaType())); break }
                        catch (error: IOException) { if (error is ApiFailure && error.status in 400..499 || attempt == 2) throw error }
                    }
                    parts.put(result!!); sent += chunk.size; progress((sent * 95 / image.original.length()).toInt())
                }
            }
            val body = MultipartBody.Builder().setType(MultipartBody.FORM)
                .addFormDataPart("parts", parts.toString()).addFormDataPart("title", "Untitled")
                .addFormDataPart("thumbnail", "preview.webp", image.thumbnail.toRequestBody("image/webp".toMediaType())).build()
            call("/api/uploads/$id", "POST", body)
            progress(100)
            return id
        } catch (error: IOException) {
            // A final response can be lost after publication. Read back before retry.
            if (runCatching { isPublished(id) }.getOrDefault(false)) { progress(100); return id }
            throw error
        }
    }
    private fun isPublished(id: String): Boolean = try { call("/api/images/$id", authenticated = false); true }
        catch (error: ApiFailure) { if (error.status == 404) false else throw error }
}
