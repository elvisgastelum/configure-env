import {
  Braces,
  FileText,
  History,
  Layers,
  LayoutDashboard,
  type LucideIcon,
  ScanSearch,
  Variable,
} from 'lucide-react';

export type PageKey =
  | 'overview'
  | 'variables'
  | 'groups'
  | 'files'
  | 'schema'
  | 'check'
  | 'history';

export interface NavItem {
  key: PageKey;
  to:
    | '/'
    | '/variables'
    | '/groups'
    | '/files'
    | '/schema'
    | '/check'
    | '/history';
  icon: LucideIcon;
}

/** The sidebar's pages, in order; the palette lists the same. */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'overview', to: '/', icon: LayoutDashboard },
  { key: 'variables', to: '/variables', icon: Variable },
  { key: 'groups', to: '/groups', icon: Layers },
  { key: 'files', to: '/files', icon: FileText },
  { key: 'schema', to: '/schema', icon: Braces },
  { key: 'check', to: '/check', icon: ScanSearch },
  { key: 'history', to: '/history', icon: History },
];
