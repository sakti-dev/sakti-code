import { Route, Router } from "@solidjs/router";
import HomeView from "./views/home-view/home-view";
import SettingsView from "./views/settings-view";
import WorkspaceView from "./views/workspace-view";

export default function Routes() {
  return (
    <Router>
      <Route path="/" component={HomeView} />
      <Route path="/workspace/:id" component={WorkspaceView} />
      <Route path="/settings" component={SettingsView} />
    </Router>
  );
}
