package xyz.catdad.artmanager

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.nio.file.Files
import java.util.zip.CRC32

class EncodedImageTest {
    @Test fun stripsPngAncillaryMetadataWithoutChangingPixels() {
        val raw = javaClass.getResourceAsStream("/pixel.png")!!.use { it.readBytes() }
        val type = "tEXt".toByteArray(); val payload = "Comment\u0000PRIVATE_TEST_METADATA".toByteArray()
        val chunk = ByteArrayOutputStream().also { buffer -> DataOutputStream(buffer).use {
            it.writeInt(payload.size); it.write(type); it.write(payload); it.writeInt(CRC32().apply { update(type + payload) }.value.toInt())
        } }.toByteArray()
        val file = Files.createTempFile("encoded", ".png").toFile()
        try {
            file.writeBytes(raw.copyOfRange(0, raw.size - 12) + chunk + raw.copyOfRange(raw.size - 12, raw.size))
            EncodedImage.clean(file, "image/png")
            assertFalse(file.readText(Charsets.ISO_8859_1).contains("PRIVATE_TEST_METADATA"))
            assertArrayEquals(raw, file.readBytes())
        } finally { file.delete() }
    }
    @Test fun stripsJpegApplicationHeadersWithoutChangingDecodedPixels() {
        val raw = javaClass.getResourceAsStream("/pixel.jpg")!!.use { it.readBytes() }
        val payload = "PRIVATE_TEST_METADATA".toByteArray()
        val header = ByteArrayOutputStream().also { buffer -> DataOutputStream(buffer).use {
            it.writeShort(0xffe1); it.writeShort(payload.size + 2); it.write(payload)
        } }.toByteArray()
        val file = Files.createTempFile("encoded", ".jpg").toFile()
        try {
            file.writeBytes(raw.copyOfRange(0, 2) + header + raw.copyOfRange(2, raw.size))
            EncodedImage.clean(file, "image/jpeg")
            assertFalse(file.readText(Charsets.ISO_8859_1).contains("PRIVATE_TEST_METADATA"))
            assertArrayEquals(raw, file.readBytes())
        } finally { file.delete() }
    }
    @Test fun truncatedContainerCannotReplacePreparedFile() {
        val file = Files.createTempFile("encoded", ".png").toFile()
        val original = byteArrayOf(137.toByte(), 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 100, 73, 68, 65, 84)
        try {
            file.writeBytes(original)
            try { EncodedImage.clean(file, "image/png"); fail("Accepted truncated image") } catch (_: java.io.IOException) { }
            assertArrayEquals(original, file.readBytes())
            assertFalse(java.io.File(file.parentFile, file.name + ".clean").exists())
        } finally { file.delete() }
    }
}
