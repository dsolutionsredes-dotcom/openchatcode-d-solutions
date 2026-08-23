import components from './components';
import dashboard from './dashboard';
import settings from './settings';
import topbar from './topbar';

export const ES: Record<string, string> = Object.assign(
  {}, components, dashboard, settings, topbar,
);
