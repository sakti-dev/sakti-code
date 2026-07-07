import { createResource, Show } from "solid-js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useStore } from "~/stores/store-context";
import { getDraftProfile, setDraftProfile } from "~/stores/workspace/draft-profile-store";

interface ProfileEntry {
  models: { default: { provider: string; model: string } };
  name: string;
}

interface ProfilesData {
  defaultProfile: string;
  profiles: Record<string, ProfileEntry>;
}

export function ProfileSelect(props: { sessionId: string | null }) {
  const { actions, api, server } = useStore();

  const [profiles] = createResource(async () => {
    const res = await api.api.profiles.$get();
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as ProfilesData;
  });

  const profileEntries = () => {
    const p = profiles();
    if (!p) {
      return [];
    }
    return Object.entries(p.profiles);
  };

  const profileIds = () => profileEntries().map(([id]) => id);

  const session = () => {
    const id = props.sessionId;
    return id ? server.store.sessions[id] : undefined;
  };

  const activeProfileId = () => {
    const p = profiles();
    if (!p) {
      return;
    }
    const s = session();
    if (s?.profileId) {
      return s.profileId;
    }
    // No session-bound profile: honour a per-project draft pick (made before the
    // first message creates a session), else fall back to the configured default.
    const projectId = server.store.activeProjectId;
    if (projectId && props.sessionId === null) {
      const draft = getDraftProfile(projectId);
      if (draft) {
        return draft;
      }
    }
    return p.defaultProfile;
  };

  const profileLabel = () => {
    const id = activeProfileId();
    if (!id) {
      return "Select profile";
    }
    const p = profiles();
    const entry = p?.profiles[id];
    return entry?.name ?? id;
  };

  const handleChange = (value: string | null) => {
    if (value === null) {
      return;
    }
    if (props.sessionId) {
      void actions.selectProfile(props.sessionId, value);
      return;
    }
    // No session yet: stash the pick as a per-project draft, applied when the
    // first message creates a session (see plan-chat.tsx).
    const projectId = server.store.activeProjectId;
    if (projectId) {
      setDraftProfile(projectId, value);
    }
  };

  return (
    <Show when={profileEntries().length > 0}>
      <Select
        itemComponent={(itemProps) => (
          <SelectItem item={itemProps.item}>
            {profiles()?.profiles[itemProps.item.rawValue]?.name ?? itemProps.item.rawValue}
          </SelectItem>
        )}
        onChange={handleChange}
        options={profileIds()}
        placeholder="Select profile"
        value={activeProfileId()}
      >
        <SelectTrigger class="h-7 gap-1 rounded-md border border-border/50 bg-transparent px-2 py-1 text-xs hover:bg-muted/50 focus:ring-1 focus:ring-primary/30 focus:ring-offset-0">
          <SelectValue<string>>{profileLabel()}</SelectValue>
        </SelectTrigger>
        <SelectContent />
      </Select>
    </Show>
  );
}
