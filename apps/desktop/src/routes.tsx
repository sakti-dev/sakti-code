import HomeView from "@renderer/views/home-view/home-view";
import SettingsView from "@renderer/views/settings-view";
import WorkspaceView from "@renderer/views/workspace-view";
import { Route, Router } from "@solidjs/router";

export default function Routes() {
  return (
    <Router>
      <Route path="/" component={HomeView} />
      <Route path="/workspace/:id" component={WorkspaceView} />
      <Route path="/settings" component={SettingsView} />
    </Router>
  );
}
