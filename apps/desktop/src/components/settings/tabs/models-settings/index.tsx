import { ConnectedProvidersList } from "./connected-providers-list";
import { HybridVisionCard } from "./hybrid-vision-card";
import { ProfileEditor } from "./profile-editor";
import { ProviderConnectModal } from "./provider-connect-modal";
import { useModelsSettings } from "./use-models-settings";

export function ModelsSettings() {
  const {
    catalogProviders,
    closeModal,
    connectedProviders,
    handleConnect,
    handleDisconnect,
    hasLoaded,
    hybridEnabled,
    initialProviderId,
    isModalOpen,
    openModal,
    setHybridEnabled,
  } = useModelsSettings();

  return (
    <>
      <ConnectedProvidersList
        hasLoaded={hasLoaded()}
        onDisconnect={handleDisconnect}
        onOpenModal={openModal}
        providers={connectedProviders()}
      />

      <ProfileEditor />

      <HybridVisionCard enabled={hybridEnabled()} onToggle={setHybridEnabled} />

      <ProviderConnectModal
        initialProviderId={initialProviderId()}
        isOpen={isModalOpen()}
        onClose={closeModal}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        providers={catalogProviders()}
      />
    </>
  );
}
