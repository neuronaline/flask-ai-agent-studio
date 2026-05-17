// Knowledge Base management — loaded on /settings page only
(function () {
  // ─── DOM refs ────────────────────────────────────────────────────────────────
  const kbSyncBtn = document.getElementById("kb-sync-btn");
  const kbStatusEl = document.getElementById("kb-status");
  const kbDocumentsListEl = document.getElementById("kb-documents-list");
  const kbUploadFileEl = document.getElementById("kb-upload-file");
  const kbUploadTitleEl = document.getElementById("kb-upload-title");
  const kbUploadDescriptionEl = document.getElementById("kb-upload-description");
  const kbUploadAutoInjectEl = document.getElementById("kb-upload-auto-inject-toggle");
  const kbSuggestBtn = document.getElementById("kb-suggest-btn");
  const kbUploadBtn = document.getElementById("kb-upload-btn");
  const kbUploadStatusEl = document.getElementById("kb-upload-status");

  if (!kbDocumentsListEl) return; // panel not in DOM

  // ─── State ──────────────────────────────────────────────────────────────────
  const appSettings = window.__appSettings || {};
  const featureFlags = window.__featureFlags || appSettings.features || {};

  // ─── Helpers ────────────────────────────────────────────────────────────────
  const autoResize = window.__domUtils?.autoResize ?? function(element) {
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  };

  function setKbStatus(message, tone = "muted") {
    if (!kbStatusEl) return;
    kbStatusEl.textContent = message;
    kbStatusEl.dataset.tone = tone;
  }

  function setKbUploadStatus(message, tone = "muted") {
    if (!kbUploadStatusEl) return;
    kbUploadStatusEl.textContent = message;
    kbUploadStatusEl.dataset.tone = tone;
  }

  function syncKbUploadActionState() {
    const ragEnabled = Boolean(featureFlags.rag_enabled);
    const hasFile = Boolean(kbUploadFileEl?.files?.length);
    if (kbSuggestBtn) kbSuggestBtn.disabled = !ragEnabled || !hasFile;
    if (kbUploadBtn) kbUploadBtn.disabled = !ragEnabled || !hasFile;
  }

  function summarizeKbDocument(doc) {
    const metadata = doc && typeof doc.metadata === "object" ? doc.metadata : {};
    const parts = [(window.__settingsCore?.RAG_SOURCE_TYPE_LABELS || {})[doc.source_type] || doc.source_type || "Document"];
    if (doc.category) parts.push(doc.category);
    parts.push(`${doc.chunk_count || 0} chunks`);
    if (metadata.file_name) parts.unshift(metadata.file_name);
    return parts.join(" · ");
  }

  function renderKnowledgeBaseDocuments(docs) {
    if (!kbDocumentsListEl) return;
    kbDocumentsListEl.innerHTML = "";
    if (!docs.length) {
      kbDocumentsListEl.innerHTML = '<p class="kb-empty">No indexed sources yet.</p>';
      return;
    }
    docs.forEach((doc) => {
      const item = document.createElement("div");
      item.className = "kb-doc-item";
      const meta = document.createElement("div");
      meta.className = "kb-doc-meta";
      const title = document.createElement("div");
      title.className = "kb-doc-title";
      title.textContent = doc.source_name || "Untitled source";
      const sub = document.createElement("div");
      sub.className = "kb-doc-subtitle";
      sub.textContent = summarizeKbDocument(doc);
      meta.append(title, sub);
      const metadata = doc && typeof doc.metadata === "object" ? doc.metadata : {};
      const description = String(metadata.description || "").trim();
      if (description) {
        const descriptionEl = document.createElement("div");
        descriptionEl.className = "kb-doc-description";
        descriptionEl.textContent = description;
        meta.append(descriptionEl);
      }
      const badges = document.createElement("div");
      badges.className = "kb-doc-badges";
      if (doc.source_type === "uploaded_document") {
        const uploadBadge = document.createElement("span");
        uploadBadge.className = "kb-doc-badge";
        uploadBadge.textContent = "manual upload";
        badges.append(uploadBadge);
      }
      const autoInjectBadge = document.createElement("span");
      autoInjectBadge.className = "kb-doc-badge";
      const globalAutoInjectEnabled = Boolean(appSettings.rag_auto_inject);
      const perDocAutoInjectEnabled = metadata.auto_inject_enabled !== false;
      const isAutoInjectOn = globalAutoInjectEnabled && perDocAutoInjectEnabled;
      autoInjectBadge.dataset.tone = isAutoInjectOn ? "success" : "muted";
      autoInjectBadge.textContent = isAutoInjectOn ? "auto inject on" : "manual only";
      badges.append(autoInjectBadge);
      meta.append(badges);
      const del = document.createElement("button");
      del.type = "button";
      del.className = "kb-doc-delete";
      del.textContent = "Delete";
      del.addEventListener("click", () => void deleteKnowledgeBaseDocument(doc.source_key));
      item.append(meta, del);
      kbDocumentsListEl.append(item);
    });
  }

  async function loadKnowledgeBaseDocuments() {
    if (!Boolean(featureFlags.rag_enabled)) {
      renderKnowledgeBaseDocuments([]);
      setKbStatus("RAG disabled in .env", "warning");
      return;
    }
    try {
      const response = await fetch("/api/rag/documents");
      if (response.status === 410) {
        renderKnowledgeBaseDocuments([]);
        setKbStatus("RAG disabled in .env", "warning");
        return;
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Failed to load: ${response.status}`);
      }
      const docs = await response.json();
      renderKnowledgeBaseDocuments(Array.isArray(docs) ? docs : []);
    } catch (_) {
      renderKnowledgeBaseDocuments([]);
      setKbStatus("Failed to load indexed sources.", "error");
    }
  }

  async function deleteKnowledgeBaseDocument(sourceKey) {
    if (!sourceKey) return;
    setKbStatus("Deleting source...");
    try {
      const response = await fetch(`/api/rag/documents/${encodeURIComponent(sourceKey)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Delete failed.");
      setKbStatus("Source deleted", "success");
      await loadKnowledgeBaseDocuments();
    } catch (error) {
      setKbStatus(error.message || "Delete failed.", "error");
    }
  }

  async function uploadKnowledgeBaseDocument() {
    if (!Boolean(featureFlags.rag_enabled)) { setKbUploadStatus("RAG disabled in .env", "warning"); return; }
    const file = kbUploadFileEl?.files?.[0];
    if (!file) { setKbUploadStatus("Choose a document to upload.", "warning"); return; }
    const formData = new FormData();
    formData.append("document", file);
    formData.append("source_name", kbUploadTitleEl?.value.trim() || "");
    formData.append("description", kbUploadDescriptionEl?.value.trim() || "");
    formData.append("auto_inject_enabled", kbUploadAutoInjectEl?.checked ? "true" : "false");
    if (kbUploadBtn) kbUploadBtn.disabled = true;
    if (kbSuggestBtn) kbSuggestBtn.disabled = true;
    setKbUploadStatus("Uploading document...");
    try {
      const response = await fetch("/api/rag/ingest", { method: "POST", body: formData });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Upload failed.");
      if (kbUploadFileEl) kbUploadFileEl.value = "";
      if (kbUploadTitleEl) kbUploadTitleEl.value = "";
      if (kbUploadDescriptionEl) { kbUploadDescriptionEl.value = ""; autoResize(kbUploadDescriptionEl); }
      if (kbUploadAutoInjectEl) kbUploadAutoInjectEl.checked = true;
      const sourceName = data.document?.source_name || data.file_name || "Document";
      setKbUploadStatus(`${sourceName} indexed`, "success");
      await loadKnowledgeBaseDocuments();
    } catch (error) {
      setKbUploadStatus(error.message || "Upload failed.", "error");
    } finally {
      syncKbUploadActionState();
    }
  }

  async function generateKnowledgeBaseMetadata() {
    if (!Boolean(featureFlags.rag_enabled)) { setKbUploadStatus("RAG disabled in .env", "warning"); return; }
    const file = kbUploadFileEl?.files?.[0];
    if (!file) { setKbUploadStatus("Choose a document first.", "warning"); return; }
    const formData = new FormData();
    formData.append("document", file);
    formData.append("source_name", kbUploadTitleEl?.value.trim() || "");
    formData.append("description", kbUploadDescriptionEl?.value.trim() || "");
    if (kbSuggestBtn) kbSuggestBtn.disabled = true;
    if (kbUploadBtn) kbUploadBtn.disabled = true;
    setKbUploadStatus("Generating title and description...", "muted");
    try {
      const response = await fetch("/api/rag/upload-metadata", { method: "POST", body: formData });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Metadata generation failed.");
      if (kbUploadTitleEl && typeof data.title === "string") kbUploadTitleEl.value = data.title;
      if (kbUploadDescriptionEl && typeof data.description === "string") { kbUploadDescriptionEl.value = data.description; autoResize(kbUploadDescriptionEl); }
      setKbUploadStatus("Title and description generated.", "success");
    } catch (error) {
      setKbUploadStatus(error.message || "Metadata generation failed.", "error");
    } finally {
      syncKbUploadActionState();
    }
  }

  async function syncKnowledgeBaseConversations() {
    if (!Boolean(featureFlags.rag_enabled)) { setKbStatus("RAG disabled in .env", "warning"); return; }
    if (kbSyncBtn) kbSyncBtn.disabled = true;
    setKbStatus("Syncing conversations into RAG...");
    try {
      const response = await fetch("/api/rag/sync-conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Conversation sync failed.");
      setKbStatus(`${data.count || 0} RAG sources synced`, "success");
      await loadKnowledgeBaseDocuments();
    } catch (error) {
      setKbStatus(error.message || "Conversation sync failed.", "error");
    } finally {
      if (kbSyncBtn) kbSyncBtn.disabled = false;
    }
  }

  // ─── Event listeners ──────────────────────────────────────────────────────────
  kbUploadFileEl?.addEventListener("change", () => {
    const filename = kbUploadFileEl.files?.[0]?.name || "";
    if (filename && kbUploadTitleEl && !kbUploadTitleEl.value.trim()) {
      kbUploadTitleEl.value = filename.replace(/\.[^.]+$/, "");
    }
    syncKbUploadActionState();
  });
  kbUploadDescriptionEl?.addEventListener("input", () => autoResize(kbUploadDescriptionEl));
  kbSuggestBtn?.addEventListener("click", () => void generateKnowledgeBaseMetadata());
  kbUploadBtn?.addEventListener("click", () => void uploadKnowledgeBaseDocument());
  kbSyncBtn?.addEventListener("click", () => void syncKnowledgeBaseConversations());

  // ─── Export ─────────────────────────────────────────────────────────────────
  window.__knowledgeBaseModule = {
    loadKnowledgeBaseDocuments,
    syncKbUploadActionState,
  };
})();
