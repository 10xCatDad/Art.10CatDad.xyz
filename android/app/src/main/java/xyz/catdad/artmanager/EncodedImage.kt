package xyz.catdad.artmanager

import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.IOException

// Android's pixel encoder can add ICC/ancillary headers. Remove those after
// re-encoding, in bounded buffers, to match the server's strict container policy.
object EncodedImage {
    fun clean(file: File, mime: String) {
        val cleaned = File(file.parentFile, file.name + ".clean")
        try {
            DataInputStream(file.inputStream().buffered()).use { input ->
                DataOutputStream(cleaned.outputStream().buffered()).use { output ->
                    fun copy(count: Long, keep: Boolean = true) {
                        if (count < 0 || count > file.length()) throw IOException("Invalid encoded image.")
                        var remaining = count; val buffer = ByteArray(16384)
                        while (remaining > 0) {
                            val length = input.read(buffer, 0, minOf(remaining, buffer.size.toLong()).toInt())
                            if (length < 0) throw IOException("Incomplete encoded image.")
                            if (keep) output.write(buffer, 0, length)
                            remaining -= length
                        }
                    }
                    if (mime == "image/png") {
                        val signature = ByteArray(8); input.readFully(signature)
                        if (!signature.contentEquals(byteArrayOf(137.toByte(), 80, 78, 71, 13, 10, 26, 10))) throw IOException("Invalid PNG.")
                        output.write(signature)
                        val allowed = setOf("IHDR", "PLTE", "tRNS", "IDAT", "IEND", "sRGB", "gAMA", "cHRM")
                        while (true) {
                            val length = input.readInt().toLong() and 0xffffffffL
                            val type = ByteArray(4); input.readFully(type)
                            val name = String(type, Charsets.US_ASCII)
                            val keep = name in allowed
                            if (keep) { output.writeInt(length.toInt()); output.write(type) }
                            copy(length + 4, keep)
                            if (name == "IEND") { if (length != 0L || input.read() != -1) throw IOException("Invalid PNG ending."); break }
                        }
                    } else if (mime == "image/jpeg") {
                        if (input.readUnsignedShort() != 0xffd8) throw IOException("Invalid JPEG.")
                        output.writeShort(0xffd8)
                        while (true) {
                            if (input.readUnsignedByte() != 0xff) throw IOException("Invalid JPEG marker.")
                            var marker = input.readUnsignedByte()
                            while (marker == 0xff) marker = input.readUnsignedByte()
                            val length = input.readUnsignedShort()
                            if (length < 2) throw IOException("Invalid JPEG header.")
                            val keep = marker !in 0xe0..0xef && marker != 0xfe
                            if (keep) { output.writeByte(0xff); output.writeByte(marker); output.writeShort(length) }
                            copy((length - 2).toLong(), keep)
                            if (marker == 0xda) { input.copyTo(output, 16384); break }
                        }
                    } else throw IOException("Unsupported encoded image.")
                }
            }
            if (!cleaned.renameTo(file)) throw IOException("Could not finish preparing the image.")
        } finally { cleaned.delete() }
    }
}
