import { createResource, Show } from "solid-js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useStore } from "~/stores/store-context";

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
    const s = session();
    if (!s) {
      return;
    }
    const p = profiles();
    if (!p) {
      return;
    }
    return s.profileId ?? p.defaultProfile;
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
    if (value !== null) {
      actions.selectProfile(props.sessionId, value);
    }
  };

  return (
    <Show when={profileEntries().length > 0}>
      <Select
        disabled={!props.sessionId}
        itemComponent={(props) => <SelectItem item={props.item}>{props.item.rawValue}</SelectItem>}
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
