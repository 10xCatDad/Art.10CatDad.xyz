package xyz.catdad.artmanager

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files

class ArtApiTest {
    private val id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    private val token = "art_device_" + "a".repeat(64)
    @Test fun redirectNeverForwardsDeviceKey() {
        MockWebServer().use { origin -> MockWebServer().use { destination ->
            origin.enqueue(MockResponse().setResponseCode(302).setHeader("Location", destination.url("/steal")))
            val api = ArtApi({ token }, origin.url("/").toString())
            try { api.session(); fail("redirect was followed") } catch (e: ApiFailure) { assertEquals(302, e.status) }
            assertEquals("Bearer $token", origin.takeRequest().getHeader("Authorization"))
            assertEquals(0, destination.requestCount)
        } }
    }
    @Test fun publicListNeverSendsKeyAndEncodesQuery() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"items":[],"total":0,"bytes":0,"nextOffset":null}"""))
            val result = ArtApi({ token }, server.url("/").toString()).list("a & b#c", "newest")
            val request = server.takeRequest()
            assertNull(request.getHeader("Authorization")); assertEquals("a & b#c", request.requestUrl!!.queryParameter("q"))
            assertNull(result.nextOffset)
        }
    }
    @Test fun lostCompletionResponseChecksForPublicationBeforeRetry() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"id":"$id","partBytes":8388608}"""))
            server.enqueue(MockResponse().setBody("""{"partNumber":1,"etag":"opaque"}"""))
            server.enqueue(MockResponse().setResponseCode(503).setBody("""{"error":"response lost"}"""))
            server.enqueue(MockResponse().setBody("""{"id":"$id"}"""))
            val file = Files.createTempFile("art-fixture", ".png").toFile().apply { writeBytes(ByteArray(16)) }
            try {
                var saved: String? = null
                val result = ArtApi({ token }, server.url("/").toString()).upload(PreparedImage(file, ByteArray(8), "image/png", 1, 1), null, { saved = it }, {})
                assertEquals(id, result); assertEquals(id, saved)
                assertEquals(4, server.requestCount)
                val requests = (1..4).map { server.takeRequest() }
                assertEquals(listOf("POST", "PUT", "POST", "GET"), requests.map { it.method })
                assertNull(requests.last().getHeader("Authorization"))
            } finally { file.delete() }
        }
    }
    @Test fun restartingPublishedUploadDoesNotPublishTwice() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"id":"$id"}"""))
            val file = Files.createTempFile("art-fixture", ".png").toFile()
            try {
                assertEquals(id, ArtApi({ token }, server.url("/").toString()).upload(PreparedImage(file, ByteArray(8), "image/png", 1, 1), id, { fail("new session created") }, {}))
                assertEquals(1, server.requestCount)
            } finally { file.delete() }
        }
    }
    @Test fun processingUploadCannotCreateDuplicateSession() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(404).setBody("""{"error":"Not found"}"""))
            server.enqueue(MockResponse().setResponseCode(409).setBody("""{"error":"Processing"}"""))
            val file = Files.createTempFile("art-fixture", ".png").toFile()
            try {
                try { ArtApi({ token }, server.url("/").toString()).upload(PreparedImage(file, ByteArray(8), "image/png", 1, 1), id, {}, {}); fail("duplicate session") }
                catch (e: ApiFailure) { assertEquals(409, e.status) }
                assertEquals(2, server.requestCount)
            } finally { file.delete() }
        }
    }
}
