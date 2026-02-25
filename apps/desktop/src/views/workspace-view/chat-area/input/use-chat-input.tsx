import { useFileSearch } from "@/core/chat/hooks";
import { type AgentMode } from "@/core/chat/types";
import { usePermissions } from "@/core/permissions/hooks/use-permissions";
import { useChatContext } from "@/state/contexts/chat-provider";
import {
  usePermissionStore,
  useProviderSelectionStore,
  useQuestionStore,
  useWorkspace,
} from "@/state/providers";
import { createMemo, createSignal } from "solid-js";
import type { ChatInputModelOption } from "./model-selector-button";
import type { PendingPermissionBannerData } from "./permission-banner";

export const useChatInput = () => {
  const ctx = useWorkspace();
  const { chat } = useChatContext();
  const providerSelection = useProviderSelectionStore();
  const [permissionState] = usePermissionStore();
  const [questionState, questionActions] = useQuestionStore();

  const fileSearch = useFileSearch(ctx.workspace);

  const isGenerating = () =>
    chat.streaming.status() === "connecting" || chat.streaming.status() === "streaming";

  const effectiveSessionId = createMemo(() => chat.sessionId() ?? ctx.activeTaskSessionId());

  const permissions = usePermissions({
    client: ctx.client()!,
    workspace: ctx.workspace,
    sessionId: effectiveSessionId,
  });

  const currentPendingPermission = createMemo(() => {
    const sessionId = effectiveSessionId();
    const nextId = sessionId
      ? permissionState.pendingOrder.find(id => permissionState.byId[id]?.sessionID === sessionId)
      : undefined;
    const fallbackId = permissionState.pendingOrder[0];
    const resolvedId = nextId ?? fallbackId;
    if (!resolvedId) return undefined;
    return permissionState.byId[resolvedId];
  });

  const currentPendingQuestion = createMemo(() => {
    const sessionId = effectiveSessionId();
    const nextId = sessionId
      ? questionState.pendingOrder.find(id => questionState.byId[id]?.sessionID === sessionId)
      : undefined;
    const fallbackId = questionState.pendingOrder[0];
    const resolvedId = nextId ?? fallbackId;
    if (!resolvedId) return undefined;
    return questionState.byId[resolvedId];
  });

  const isPromptBlocked = createMemo(
    () => Boolean(currentPendingPermission()) || Boolean(currentPendingQuestion())
  );

  const pendingPermissionBanner = createMemo((): PendingPermissionBannerData | null => {
    const pending = currentPendingPermission();
    if (!pending) return null;
    return {
      id: pending.id,
      toolName: pending.toolName,
      description: pending.description,
      patterns: pending.patterns,
    };
  });

  const handleApprovePermission = (id: string, patterns?: string[]) => {
    void permissions.approve(id, patterns);
  };

  const handleDenyPermission = (id: string) => {
    void permissions.deny(id);
  };

  const handleAnswerQuestion = (id: string, answer: unknown) => {
    const client = ctx.client();
    if (!client) return;

    void client.replyQuestion(id, answer).then(result => {
      if (!result.success) return;
      questionActions.answer(id, answer);
    });
  };

  const handleRejectQuestion = (id: string) => {
    const client = ctx.client();
    if (!client) return;

    const payload = { rejected: true };
    void client.rejectQuestion(id).then(result => {
      if (!result.success) return;
      questionActions.answer(id, payload);
    });
  };

  const [agentMode, setAgentMode] = createSignal<AgentMode>("plan");

  const modelOptions = createMemo<ChatInputModelOption[]>(() =>
    providerSelection.docs().map(model => ({
      id: model.id,
      providerId: model.providerId,
      name: model.name,
      connected: model.connected,
    }))
  );

  const selectedModel = createMemo(
    () => providerSelection.data()?.preferences.selectedModelId ?? ""
  );

  const mapDocToOption = (model: {
    id: string;
    providerId: string;
    providerName?: string;
    name?: string;
    connected: boolean;
  }): ChatInputModelOption => ({
    id: model.id,
    providerId: model.providerId,
    providerName: model.providerName,
    name: model.name,
    connected: model.connected,
  });

  const connectedModelOptions = (query: string): ChatInputModelOption[] =>
    providerSelection.connectedResults(query).map(mapDocToOption);

  const notConnectedModelOptions = (query: string): ChatInputModelOption[] =>
    providerSelection.notConnectedResults(query).map(mapDocToOption);

  const modelSections = (query: string) =>
    providerSelection.providerGroupedSections(query).map(section => ({
      providerId: section.providerId,
      providerName: section.providerName,
      connected: section.connected,
      models: section.models.map(mapDocToOption),
    }));

  const handleModelChange = (modelId: string) => {
    const selected = modelOptions().find(model => model.id === modelId);
    if (!selected) return;
    void providerSelection.setSelectedModel(selected.id).catch(error => {
      console.error("Failed to persist provider preferences:", error);
    });
  };

  const [draftMessage, setDraftMessage] = createSignal("");

  const handleSendMessage = async () => {
    const content = draftMessage().trim();
    if (!content || isGenerating() || isPromptBlocked()) return;
    await chat.sendMessage(content);
    setDraftMessage("");
  };

  return {
    draftMessage,
    setDraftMessage,
    handleSendMessage,
    agentMode,
    setAgentMode,
    modelOptions,
    selectedModel,
    connectedModelOptions,
    notConnectedModelOptions,
    modelSections,
    handleModelChange,
    isGenerating,
    isPromptBlocked,
    pendingPermissionBanner,
    handleApprovePermission,
    handleDenyPermission,
    handleAnswerQuestion,
    handleRejectQuestion,
    workspace: ctx.workspace,
    getFileSearchResults: (query: string) =>
      fileSearch.search(query).then(() => fileSearch.results()),
  };
};
