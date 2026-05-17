// ============================================================================
// PHASE 2: Grouped State Objects
// Replaces 60+ scattered global let variables with logical groupings.
// TODO: Migrate all references from individual vars to state.group.property
// ============================================================================

const chatState = {
  isStreaming: false,
  isFixing: false,
  activeAbortController: null,
  activeChatRunId: null,
  activeUserCancelRequested: false,
  activeChatCancellationFallbackTimer: null,
  activeAssistantStreamingBubble: null,
  activeAssistantStreamingHasVisibleAnswer: false,
  history: [],
  currentConvId: null,
  currentConvTitle: "New Chat",
  currentConversationPersonaId: null,
  currentConversationPersonaName: "",
  currentConversationTitleSource: "system",
  currentConversationTitleOverridden: false,
  conversationMemoryEntries: [],
  conversationMemoryEnabled: false,
  currentConversationToolOverrides: null,
  currentConversationParameterOverrides: null,
};

const canvasState = {
  activeCanvasDocumentId: null,
  streamingCanvasDocuments: [],
  isCanvasEditing: false,
  editingCanvasDocumentId: null,
  canvasPageByDocumentId: new Map(),
  pendingCanvasPageSyncFrame: 0,
  canvasHasUnreadUpdates: false,
  lastCanvasTriggerEl: null,
  lastCanvasConfirmTriggerEl: null,
  pendingCanvasMutation: "",
  // Canvas render state (formerly CanvasRenderState class - Step 2.5)
  deferredPanelRender: false,
  deferredPreviewRender: false,
  pendingFlushTimer: 0,
  lastPreviewRenderAt: 0,
  pendingPreviewTimer: 0,
  pendingEditorPreviewTimer: 0,
  streamingPreviews: new Map(),
  structureSignature: '',
  docListSignature: '',
  // Methods formerly from CanvasRenderState class
  resetDeferred() {
    this.deferredPanelRender = false;
    this.deferredPreviewRender = false;
  },
  clear() {
    this.pendingFlushTimer = 0;
    this.pendingPreviewTimer = 0;
    this.pendingEditorPreviewTimer = 0;
    this.deferredPanelRender = false;
    this.deferredPreviewRender = false;
    this.lastPreviewRenderAt = 0;
    this.streamingPreviews.clear();
  },
};

const summaryState = {
  isSummaryOperationInFlight: false,
  summaryProgressTimer: 0,
  summaryProgressCurrentValue: 0,
  summaryPreviewConversationId: null,
  latestSummaryStatus: null,
};

const uiState = {
  messageSelectionMode: null,
  selectedSummaryMessageIds: new Set(),
  conversationRefreshGeneration: 0,
  pendingConversationRefreshTimers: new Set(),
  lastConversationSignature: "",
  lastConversationMemorySignature: "",
  userScrolledUp: false,
  pendingCanvasConfirmAction: null,
  slashCommandMenuOpen: false,
  slashCommandMenuQuery: "",
  slashCommandSuggestions: [],
  slashCommandSelectedIndex: 0,
  isCanvasFullscreen: false,
  isCanvasMobileTreeOpen: false,
  canvasZoomLevelIndex: 0,
};

const attachmentState = {
  selectedImageFiles: [],
  selectedDocumentFiles: [],
  selectedDocumentSubmissionModes: new Map(),
  selectedYouTubeUrl: "",
  pendingDocumentCanvasOpen: null,
  nextAttachmentFileKeyId: 1,
  attachmentFileKeyByObject: new Map(),
};

const messageEditState = {
  editingMessageId: null,
  inlineEditingMessageId: null,
  inlineEditingDraft: "",
  savingEditedMessageId: null,
  pendingDeleteMessageId: null,
  deletingMessageId: null,
  activeDeleteMessageAbortController: null,
};

const lastTriggerState = {
  lastExportTriggerEl: null,
  lastSummaryTriggerEl: null,
};
