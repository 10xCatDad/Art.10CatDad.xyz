package xyz.catdad.artmanager

import android.app.Application
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.IOException

class ArtViewModel(application: Application) : AndroidViewModel(application) {
    private val vault = TokenVault(application)
    private val inbox = MediaInbox(application)
    private val prefs = application.getSharedPreferences("preferences", 0)
    @Volatile private var token: String? = null
    val api = ArtApi({ token })
    var session by mutableStateOf<DeviceSession?>(null); private set
    var connecting by mutableStateOf(false); private set
    var page by mutableStateOf("Media")
    var theme by mutableStateOf(prefs.getString("theme", "System") ?: "System"); private set
    var error by mutableStateOf<String?>(null); private set
    var images by mutableStateOf(emptyList<ArtImage>()); private set
    var total by mutableStateOf(0); private set
    var bytes by mutableStateOf(0L); private set
    var nextOffset by mutableStateOf<Int?>(null); private set
    var query by mutableStateOf(""); private set
    var sort by mutableStateOf("newest"); private set
    var loading by mutableStateOf(false); private set
    var drafts by mutableStateOf(emptyList<Draft>()); private set
    var importing by mutableStateOf(false); private set
    var uploading by mutableStateOf(false); private set
    var stopRequested by mutableStateOf(false); private set
    var editing by mutableStateOf<ArtImage?>(null)
    var saving by mutableStateOf(false); private set
    var suggestions by mutableStateOf(emptyList<String>()); private set
    var tagging by mutableStateOf(false); private set
    private val inboxLock = Mutex()
    private var listingJob: Job? = null
    private var tagJob: Job? = null
    private var requestGeneration = 0
    init {
        viewModelScope.launch {
            inboxLock.withLock { drafts = withContext(Dispatchers.IO) { inbox.load() } }
            token = withContext(Dispatchers.IO) { vault.read() }
            if (token != null) connect(token!!, false)
        }
    }
    fun clearError() { error = null }
    fun changeTheme(value: String) { theme = value; prefs.edit().putString("theme", value).apply() }
    private fun failed(exception: Exception) {
        error = if (exception is IOException || exception is IllegalArgumentException) exception.message ?: "The request failed. Try again." else "The request failed. Try again."
        if (exception is ApiFailure && exception.status == 401) { session = null; page = "Settings"; images = emptyList() }
    }
    fun connect(input: String, persist: Boolean = true) {
        if (connecting || uploading) return
        val candidate = input.trim()
        if (!ArtApi.tokenPattern.matches(candidate)) { error = "Paste the device key from Manage devices."; return }
        connecting = true; error = null
        viewModelScope.launch {
            try {
                val connected = withContext(Dispatchers.IO) {
                    val result = ArtApi({ candidate }).session()
                    if (persist) vault.write(candidate)
                    result
                }
                token = candidate; session = connected; page = if (drafts.any { it.state != "Uploaded" }) "Inbox" else "Media"
                refresh()
            } catch (exception: Exception) { failed(exception) }
            finally { connecting = false }
        }
    }
    fun reconnect() { token?.let { connect(it, false) } }
    fun disconnect() {
        if (uploading || connecting || saving || importing) return
        viewModelScope.launch {
            connecting = true
            try {
                withContext(Dispatchers.IO) { try { api.disconnect() } catch (e: ApiFailure) { if (e.status != 401) throw e }; vault.clear() }
                token = null; session = null; images = emptyList(); editing = null; page = "Settings"; error = null
                listingJob?.cancel(); tagJob?.cancel(); requestGeneration++
            } catch (exception: Exception) { failed(exception) }
            finally { connecting = false }
        }
    }
    fun search(value: String) { query = value.take(160); refresh(debounce = true) }
    fun sort(value: String) { sort = value; refresh() }
    fun refresh(more: Boolean = false, debounce: Boolean = false) {
        if (session == null) return
        if (more && (loading || nextOffset == null)) return
        val offset = if (more) nextOffset!! else 0
        val generation = ++requestGeneration
        val q = query; val order = sort
        listingJob?.cancel()
        listingJob = viewModelScope.launch {
            loading = true
            try {
                if (debounce) delay(250)
                val result = withContext(Dispatchers.IO) { api.list(q, order, offset) }
                if (generation == requestGeneration) {
                    images = if (more) (images + result.items).distinctBy { it.id } else result.items
                    total = result.total; bytes = result.bytes; nextOffset = result.nextOffset
                }
            } catch (exception: kotlinx.coroutines.CancellationException) { throw exception }
            catch (exception: Exception) { if (generation == requestGeneration) failed(exception) }
            finally { if (generation == requestGeneration) loading = false }
        }
    }
    fun edit(image: ArtImage) { tagJob?.cancel(); tagging = false; suggestions = emptyList(); editing = image; error = null }
    fun save(image: ArtImage) {
        if (saving || session == null) return
        saving = true; error = null
        viewModelScope.launch {
            try { withContext(Dispatchers.IO) { api.save(image) }; editing = null; tagJob?.cancel(); refresh() }
            catch (exception: Exception) { failed(exception) }
            finally { saving = false }
        }
    }
    fun delete(image: ArtImage) {
        if (saving || session == null) return
        saving = true; error = null
        viewModelScope.launch {
            try { withContext(Dispatchers.IO) { api.delete(image.id) }; editing = null; tagJob?.cancel(); refresh() }
            catch (exception: Exception) { failed(exception) }
            finally { saving = false }
        }
    }
    fun generateTags(image: ArtImage) {
        if (tagging) return
        tagging = true; suggestions = emptyList(); error = null
        tagJob = viewModelScope.launch {
            try {
                var result = withContext(Dispatchers.IO) { api.tags(image.id, true) }
                repeat(45) {
                    if (result.optString("state") == "done") {
                        val tags = result.getJSONArray("tags")
                        suggestions = (0 until tags.length()).map { tags.getString(it) }
                        return@launch
                    }
                    if (result.optString("state") !in listOf("pending", "running")) throw IOException("Tag generation did not finish. Try again.")
                    delay(2000); result = withContext(Dispatchers.IO) { api.tags(image.id, false) }
                }
                error = "Tags are still processing. Check again shortly."
            } catch (exception: kotlinx.coroutines.CancellationException) { throw exception }
            catch (exception: Exception) { failed(exception) }
            finally { tagging = false }
        }
    }
    fun importImages(uris: List<Uri>) {
        if (uris.isEmpty()) return
        page = "Inbox"
        viewModelScope.launch { inboxLock.withLock {
            importing = true; error = null
            try {
                if (uris.size + drafts.count { it.state != "Uploaded" } > 10) throw IOException("Keep up to 10 images in the inbox at a time.")
                for (uri in uris) {
                    try {
                        val draft = withContext(Dispatchers.IO) { inbox.import(uri) }
                        drafts = drafts + draft
                        persistDrafts()
                    } catch (exception: Exception) { failed(exception) }
                }
            } catch (exception: Exception) { failed(exception) }
            finally { importing = false }
        } }
    }
    private suspend fun persistDrafts() { val snapshot = drafts; withContext(Dispatchers.IO) { inbox.save(snapshot) } }
    fun remove(draft: Draft) {
        if (uploading || importing) return
        viewModelScope.launch { inboxLock.withLock {
            drafts = drafts.filterNot { it.id == draft.id }; persistDrafts(); withContext(Dispatchers.IO) { inbox.remove(draft) }
        } }
    }
    fun stopAfterCurrent() { stopRequested = true }
    fun upload() {
        if (uploading || importing || session == null) return
        uploading = true; stopRequested = false; error = null
        viewModelScope.launch { inboxLock.withLock {
            try {
                for (draft in drafts.filter { it.state != "Uploaded" }) {
                    if (stopRequested || session == null) break
                    drafts = drafts.map { if (it.id == draft.id) it.copy(state = "Uploading", error = null, progress = 0) else it }; persistDrafts()
                    try {
                        withContext(Dispatchers.IO) {
                            val prepared = inbox.prepare(draft)
                            try {
                                api.upload(prepared, draft.uploadId, onSession = { id ->
                                    val snapshot = runBlocking(Dispatchers.Main) {
                                        drafts = drafts.map { if (it.id == draft.id) it.copy(uploadId = id) else it }; drafts
                                    }
                                    inbox.save(snapshot)
                                }, progress = { progress -> viewModelScope.launch {
                                    drafts = drafts.map { if (it.id == draft.id && it.state == "Uploading") it.copy(progress = progress) else it }
                                } })
                            } finally { prepared.original.delete() }
                        }
                        drafts = drafts.map { if (it.id == draft.id) it.copy(state = "Uploaded", progress = 100, error = null) else it }; persistDrafts()
                        withContext(Dispatchers.IO) { inbox.remove(draft) }
                    } catch (exception: Exception) {
                        drafts = drafts.map { if (it.id == draft.id) it.copy(state = "Retry", error = exception.message ?: "Could not upload this image.") else it }; persistDrafts()
                        if (exception is ApiFailure && exception.status == 401) { failed(exception); break }
                    }
                }
                refresh()
            } finally { uploading = false; stopRequested = false }
        } }
    }
}
