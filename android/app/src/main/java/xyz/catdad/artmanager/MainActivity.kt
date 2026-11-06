package xyz.catdad.artmanager

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.Image
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items as gridItems
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.IntentCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Request
import java.text.DateFormat
import java.util.Date
import java.util.Locale

class MainActivity : ComponentActivity() {
    private val model: ArtViewModel by viewModels()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val dark = when (model.theme) { "Light" -> false; "Dark" -> true; else -> isSystemInDarkTheme() }
            val palette = if (dark) darkColorScheme(
                primary = Color(0xFF39FF88), onPrimary = Color.Black, primaryContainer = Color(0xFF123821), onPrimaryContainer = Color(0xFF91FFB8),
                secondary = Color(0xFF39FF88), onSecondary = Color.Black, secondaryContainer = Color(0xFF173823), onSecondaryContainer = Color(0xFF91FFB8),
                background = Color.Black, onBackground = Color(0xFFF3F5F4), surface = Color(0xFF101312), onSurface = Color(0xFFF3F5F4),
                surfaceVariant = Color(0xFF1C201E), onSurfaceVariant = Color(0xFFBAC4BD), surfaceTint = Color(0xFF39FF88),
                surfaceDim = Color.Black, surfaceBright = Color(0xFF262B28), surfaceContainerLowest = Color.Black,
                surfaceContainerLow = Color(0xFF080B09), surfaceContainer = Color(0xFF101312), surfaceContainerHigh = Color(0xFF171C19),
                surfaceContainerHighest = Color(0xFF202622), outline = Color(0xFF6A776E), outlineVariant = Color(0xFF303B34))
            else lightColorScheme(
                primary = Color(0xFF006C36), onPrimary = Color.White, primaryContainer = Color(0xFFCFEDD9), onPrimaryContainer = Color(0xFF002E15),
                secondary = Color(0xFF315840), onSecondary = Color.White, secondaryContainer = Color(0xFFD6EBDD), onSecondaryContainer = Color(0xFF183B25),
                background = Color(0xFFF8FAF8), onBackground = Color(0xFF18201B), surface = Color.White, onSurface = Color(0xFF18201B),
                surfaceVariant = Color(0xFFE7EBE8), onSurfaceVariant = Color(0xFF4C574F), surfaceTint = Color(0xFF006C36),
                surfaceDim = Color(0xFFD9E0DA), surfaceBright = Color.White, surfaceContainerLowest = Color.White,
                surfaceContainerLow = Color(0xFFF4F6F4), surfaceContainer = Color(0xFFEFF2EF), surfaceContainerHigh = Color(0xFFE8EDE9),
                surfaceContainerHighest = Color(0xFFE1E7E2), outline = Color(0xFF727C75), outlineVariant = Color(0xFFC6CFC9))
            val base = Typography(); val font = FontFamily(Font(R.font.space_grotesk))
            MaterialTheme(colorScheme = palette, typography = Typography(
                headlineLarge = base.headlineLarge.copy(fontFamily = font), headlineMedium = base.headlineMedium.copy(fontFamily = font),
                titleLarge = base.titleLarge.copy(fontFamily = font), titleMedium = base.titleMedium.copy(fontFamily = font),
                bodyLarge = base.bodyLarge.copy(fontFamily = font), bodyMedium = base.bodyMedium.copy(fontFamily = font),
                bodySmall = base.bodySmall.copy(fontFamily = font), labelLarge = base.labelLarge.copy(fontFamily = font))) {
                DisposableEffect(model.uploading, model.session) {
                    if (model.uploading) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    if (model.session == null) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE) else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                    onDispose { }
                }
                ArtApp(model)
            }
        }
        if (savedInstanceState == null) receiveShare(intent)
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); receiveShare(intent) }
    private fun receiveShare(intent: Intent) {
        if (intent.action !in listOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE) || intent.type?.startsWith("image/") != true) return
        val uris = if (intent.action == Intent.ACTION_SEND_MULTIPLE) IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
        else listOfNotNull(IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java))
        model.importImages(uris.distinct().take(11))
        // A restored Activity must not import the same share twice.
        setIntent(Intent(this, MainActivity::class.java))
    }
}

private fun openBrowser(context: Context, path: String) {
    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.SITE_URL + path)).addCategory(Intent.CATEGORY_BROWSABLE)) }
}
private fun formatSize(bytes: Long) = if (bytes >= 1024L * 1024 * 1024) String.format(Locale.ROOT, "%.1f GiB", bytes / (1024.0 * 1024 * 1024)) else String.format(Locale.ROOT, "%.1f MiB", bytes / (1024.0 * 1024))
private fun date(millis: Long) = DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(millis))

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun ArtApp(model: ArtViewModel) {
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments(), model::importImages)
    val context = LocalContext.current
    val editor = model.editing
    BackHandler(editor != null && !model.saving) { model.editing = null }
    Scaffold(
        topBar = { TopAppBar(title = { Column { Text(if (editor != null) "Edit image" else "ART // MANAGER", style = MaterialTheme.typography.titleLarge); Text("10xCatDad", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) } },
            navigationIcon = { if (editor != null) IconButton(onClick = { model.editing = null }, enabled = !model.saving) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back to media") } },
            actions = { if (editor == null && model.session != null) IconButton(onClick = { model.refresh() }, enabled = !model.loading) { Icon(Icons.Outlined.Refresh, "Refresh media") } }) },
        bottomBar = { if (editor == null) NavigationBar {
            listOf("Media" to Icons.Outlined.PhotoLibrary, "Inbox" to Icons.Outlined.Upload, "Settings" to Icons.Outlined.Settings).forEach { (name, icon) ->
                NavigationBarItem(selected = model.page == name, onClick = { model.page = name }, icon = { Icon(icon, null) }, label = { Text(if (name == "Inbox" && model.drafts.any { it.state != "Uploaded" }) "Inbox (${model.drafts.count { it.state != "Uploaded" }})" else name) })
            }
        } }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).imePadding()) {
            model.error?.let { message -> Surface(color = MaterialTheme.colorScheme.errorContainer) {
                Row(Modifier.fillMaxWidth().padding(start = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(message, Modifier.weight(1f), color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodySmall)
                    IconButton(onClick = model::clearError) { Icon(Icons.Outlined.Close, "Dismiss error") }
                }
            } }
            when {
                editor != null -> Editor(model, editor)
                model.page == "Inbox" -> Inbox(model) { picker.launch(arrayOf("image/jpeg", "image/png", "image/webp")) }
                model.page == "Settings" || model.session == null -> Settings(model)
                else -> Media(model) { model.page = "Inbox"; picker.launch(arrayOf("image/jpeg", "image/png", "image/webp")) }
            }
        }
    }
}

@Composable private fun Settings(model: ArtViewModel) {
    val context = LocalContext.current
    var key by remember { mutableStateOf("") }
    var disconnect by remember { mutableStateOf(false) }
    LaunchedEffect(model.session) { if (model.session != null) key = "" }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(if (model.session == null) "Connect your gallery" else "Connection", style = MaterialTheme.typography.headlineMedium)
        Text("Upload and manage media on art.10xCatDad.xyz.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (model.session == null) {
            Card { Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text("1 // Create a device key", style = MaterialTheme.typography.titleMedium)
                Text("Open device setup in your browser and sign in with the gallery owner account.", style = MaterialTheme.typography.bodyMedium)
                OutlinedButton(onClick = { openBrowser(context, "/manage/devices") }) { Icon(Icons.Outlined.OpenInBrowser, null); Spacer(Modifier.width(8.dp)); Text("OPEN DEVICE SETUP") }
                Text("2 // Connect this app", style = MaterialTheme.typography.titleMedium)
                OutlinedTextField(key, onValueChange = { key = it.take(100) }, label = { Text("Device key") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
                Button(onClick = { model.connect(key); key = "" }, enabled = key.isNotBlank() && !model.connecting, modifier = Modifier.fillMaxWidth()) {
                    Text(if (model.connecting) "CONNECTING" else "CONNECT")
                }
                TextButton(onClick = model::reconnect, enabled = !model.connecting) { Text("RETRY SAVED CONNECTION") }
            } }
        } else {
            val session = model.session!!
            Card { Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(session.name, style = MaterialTheme.typography.titleLarge)
                Text("Connected // expires ${date(session.expiresAt)}")
                Text("Tag worker // ${if (session.taggerOnline) "online at last check" else "offline at last check"}", style = MaterialTheme.typography.bodySmall)
                OutlinedButton(onClick = { openBrowser(context, "/manage/devices") }) { Text("MANAGE DEVICES") }
                OutlinedButton(onClick = { openBrowser(context, "/manage") }) { Text("OPEN WEB MANAGER") }
                TextButton(onClick = { disconnect = true }, enabled = !model.uploading && !model.importing && !model.connecting && !model.saving) { Text("DISCONNECT THIS DEVICE") }
            } }
        }
        Text("Appearance", style = MaterialTheme.typography.titleMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            listOf("System" to Icons.Outlined.BrightnessAuto, "Light" to Icons.Outlined.LightMode, "Dark" to Icons.Outlined.DarkMode).forEach { (name, icon) ->
                FilledIconToggleButton(checked = model.theme == name, onCheckedChange = { model.changeTheme(name) }) { Icon(icon, "$name theme") }
            }
        }
        Text("Keys stay encrypted on this device. Uploaded media, titles, descriptions, and tags are public. Keep source artwork separately.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text("Art Manager ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall)
    }
    if (disconnect) AlertDialog(onDismissRequest = { disconnect = false }, title = { Text("Disconnect this device?") }, text = { Text("This revokes its key. Local inbox images stay on this phone.") },
        confirmButton = { TextButton(onClick = { disconnect = false; model.disconnect() }) { Text("DISCONNECT") } }, dismissButton = { TextButton(onClick = { disconnect = false }) { Text("CANCEL") } })
}

@Composable private fun Media(model: ArtViewModel, choose: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Column { Text("Media", style = MaterialTheme.typography.headlineMedium); Text("${model.total} ${if (model.total == 1) "image" else "images"} // ${formatSize(model.bytes)}", style = MaterialTheme.typography.bodySmall) }
            Button(onClick = choose, enabled = !model.uploading && !model.importing) { Icon(Icons.Outlined.Add, null); Text("ADD") }
        }
        OutlinedTextField(model.query, model::search, label = { Text("Search title, description, tags") }, singleLine = true, leadingIcon = { Icon(Icons.Outlined.Search, null) }, modifier = Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("newest" to "Newest", "oldest" to "Oldest", "title" to "Title").forEach { (value, label) -> FilterChip(selected = model.sort == value, onClick = { model.sort(value) }, label = { Text(label) }) }
        }
        if (model.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (!model.loading && model.images.isEmpty()) {
            Text(if (model.query.isBlank()) "No media yet. Add images to publish them." else "No matching images.", Modifier.padding(vertical = 28.dp))
        }
        LazyVerticalGrid(columns = GridCells.Adaptive(155.dp), verticalArrangement = Arrangement.spacedBy(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.weight(1f)) {
            gridItems(model.images, key = { it.id }) { item -> Card(onClick = { model.edit(item) }) {
                Thumbnail(model.api.thumbnailUrl(item.id), item.title, Modifier.fillMaxWidth().aspectRatio(1f))
                Column(Modifier.padding(12.dp)) {
                    Text(item.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
                    Text(item.tags.ifBlank { "No tags" }, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("${item.width} × ${item.height}", style = MaterialTheme.typography.bodySmall)
                }
            } }
            if (model.nextOffset != null) item(span = { GridItemSpan(maxLineSpan) }) {
                OutlinedButton(onClick = { model.refresh(more = true) }, enabled = !model.loading, modifier = Modifier.fillMaxWidth()) { Text("LOAD MORE") }
            }
            item(span = { GridItemSpan(maxLineSpan) }) { Spacer(Modifier.height(16.dp)) }
        }
    }
}

@Composable private fun Thumbnail(url: String, description: String, modifier: Modifier = Modifier) {
    val bitmap by produceState<android.graphics.Bitmap?>(null, url) {
        value = withContext(Dispatchers.IO) { runCatching {
            ArtApi.publicClient.newCall(Request.Builder().url(url).build()).execute().use { response ->
                if (!response.isSuccessful) null else response.body?.byteStream()?.use { stream -> BitmapFactory.decodeStream(stream) }
            }
        }.getOrNull() }
    }
    Box(modifier, contentAlignment = Alignment.Center) {
        if (bitmap != null) Image(bitmap!!.asImageBitmap(), description, Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
        else Icon(Icons.Outlined.Image, description, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable private fun Inbox(model: ArtViewModel, choose: () -> Unit) {
    var confirm by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Upload inbox", style = MaterialTheme.typography.headlineMedium)
        Text("Choose images or share them to Art Manager. Nothing publishes until you tap Upload.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedButton(onClick = choose, enabled = !model.importing && !model.uploading, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.AddPhotoAlternate, null); Spacer(Modifier.width(8.dp)); Text("CHOOSE IMAGES") }
        if (model.importing) LinearProgressIndicator(Modifier.fillMaxWidth())
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(model.drafts, key = { it.id }) { draft -> Card {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Text(draft.name, maxLines = 2, overflow = TextOverflow.Ellipsis); Text(if (draft.state == "Uploading") "Uploading // ${draft.progress}%" else draft.state, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary) }
                        IconButton(onClick = { model.remove(draft) }, enabled = !model.uploading && !model.importing) { Icon(Icons.Outlined.Close, "Remove ${draft.name} from inbox") }
                    }
                    if (draft.state == "Uploading") LinearProgressIndicator(progress = { draft.progress / 100f }, modifier = Modifier.fillMaxWidth())
                    draft.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                }
            } }
            if (model.drafts.isEmpty()) item { Text("Your inbox is empty.", Modifier.padding(vertical = 28.dp)) }
        }
        Text("JPG, PNG, WebP // up to 24 MP and 100 MiB each. Metadata is removed. Keep the app open while uploading.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (model.uploading) OutlinedButton(onClick = model::stopAfterCurrent, enabled = !model.stopRequested, modifier = Modifier.fillMaxWidth()) { Text(if (model.stopRequested) "STOPPING AFTER THIS IMAGE" else "STOP AFTER THIS IMAGE") }
        else Button(onClick = { if (model.session == null) model.page = "Settings" else confirm = true }, enabled = !model.importing && model.drafts.any { it.state != "Uploaded" }, modifier = Modifier.fillMaxWidth()) {
            val count = model.drafts.count { it.state != "Uploaded" }
            Text(if (model.session == null) "CONNECT TO UPLOAD" else "UPLOAD $count ${if (count == 1) "IMAGE" else "IMAGES"}")
        }
    }
    if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text("Publish these images?") }, text = { Text("They will appear publicly in your gallery. Embedded metadata is removed; visible content stays unchanged. Titles start as Untitled.") }, confirmButton = { TextButton(onClick = { confirm = false; model.upload() }) { Text("UPLOAD") } }, dismissButton = { TextButton(onClick = { confirm = false }) { Text("CANCEL") } })
}

@Composable private fun Editor(model: ArtViewModel, item: ArtImage) {
    var title by rememberSaveable(item.id) { mutableStateOf(item.title) }
    var caption by rememberSaveable(item.id) { mutableStateOf(item.caption) }
    var tags by rememberSaveable(item.id) { mutableStateOf(item.tags) }
    var confirmDelete by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }
    val context = LocalContext.current
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Thumbnail(model.api.thumbnailUrl(item.id), item.title, Modifier.fillMaxWidth().height(190.dp))
        Text("${item.width} × ${item.height} // ${formatSize(item.bytes)}", style = MaterialTheme.typography.bodySmall)
        OutlinedTextField(title, { title = it.take(160) }, label = { Text("Title") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        OutlinedTextField(caption, { caption = it.take(3000) }, label = { Text("Description") }, modifier = Modifier.fillMaxWidth(), minLines = 2, maxLines = 6)
        OutlinedTextField(tags, { tags = it.take(600) }, label = { Text("Tags, separated by commas") }, modifier = Modifier.fillMaxWidth())
        OutlinedButton(onClick = { model.generateTags(item) }, enabled = !model.tagging && !model.saving) { Text(if (model.tagging) "GENERATING TAGS" else "SUGGEST TAGS") }
        if (model.suggestions.isNotEmpty()) {
            Text(model.suggestions.joinToString(", "), style = MaterialTheme.typography.bodyMedium)
            TextButton(onClick = { tags = (tags.split(",").map { it.trim() }.filter { it.isNotBlank() } + model.suggestions).distinct().take(12).joinToString(", ") }) { Text("ADD SUGGESTIONS") }
        }
        Text("Changes are public when saved.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick = { model.save(item.copy(title = title, caption = caption, tags = tags)) }, enabled = !model.saving, modifier = Modifier.fillMaxWidth()) { Text(if (model.saving) "SAVING" else "SAVE CHANGES") }
        OutlinedButton(onClick = {
            (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Image link", "${BuildConfig.SITE_URL}/?image=${item.id}")); copied = true
        }, modifier = Modifier.fillMaxWidth()) { Text(if (copied) "LINK COPIED" else "COPY PUBLIC LINK") }
        TextButton(onClick = { confirmDelete = true }, enabled = !model.saving, modifier = Modifier.fillMaxWidth()) { Text("DELETE IMAGE", color = MaterialTheme.colorScheme.error) }
    }
    if (confirmDelete) AlertDialog(onDismissRequest = { confirmDelete = false }, title = { Text("Delete this image?") }, text = { Text("This permanently removes “${item.title}” from the gallery and storage.") },
        confirmButton = { TextButton(onClick = { confirmDelete = false; model.delete(item) }) { Text("DELETE") } }, dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("CANCEL") } })
}
