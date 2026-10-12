import { PageEntrance } from '@configure-env/design-system/motion/page-entrance';
import {
  Outlet,
  createRootRouteWithContext,
  useLocation,
} from '@tanstack/react-router';
import { AppShell } from '../components/app-shell';
import type { RouterContext } from '../router';

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

/** Every page inside the shell; a new route plays its entrance again. */
function RootLayout() {
  const pathname = useLocation({ select: (location) => location.pathname });
  return (
    <AppShell>
      <PageEntrance key={pathname}>
        <Outlet />
      </PageEntrance>
    </AppShell>
  );
}
