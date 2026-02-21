import { AppProvider } from "@/state/providers";
import HomeView from "@/views/home-view/home-view";
import WorkspaceView from "@/views/workspace-view";
import { Route, Router } from "@solidjs/router";

interface RoutesProps {
  config: {
    baseUrl: string;
    token?: string;
  };
}

export default function Routes(props: RoutesProps) {
  return (
    <Router
      root={routerProps => <AppProvider config={props.config}>{routerProps.children}</AppProvider>}
    >
      <Route path="/" component={HomeView} />
      <Route path="/workspace/:id" component={WorkspaceView} />
    </Router>
  );
}
