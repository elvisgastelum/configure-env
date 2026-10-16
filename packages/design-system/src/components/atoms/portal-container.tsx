import * as React from 'react';

/**
 * Where popups (menus) portal to. By default a portal renders at the end of
 * <body>, outside every landmark and, while a modal dialog is open, inside
 * the content the dialog makes inert. A provider names an element instead:
 * the app shell one inside <main>, and each dialog, sheet and drawer one
 * inside its own popup, so a menu opened there stays in the dialog.
 *
 * A dialog or sheet holds its container inside the popup, so a menu opened
 * in one whose popup scrolls (an `overflow-*` class) is clipped at its edge.
 * The drawer keeps its container outside its clipping content; give a
 * scrolling dialog or sheet a scrolling child instead of scrolling the popup
 * before a menu opens in it.
 */
const PortalContainerContext = React.createContext<HTMLElement | null>(null);

/** The element popups portal to, or null for <body>. */
export function usePortalContainer(): HTMLElement | null {
  return React.useContext(PortalContainerContext);
}

/**
 * Renders `children` with an empty element after them that popups opened
 * inside portal to.
 */
export function PortalContainer({ children }: { children: React.ReactNode }) {
  const [container, setContainer] = React.useState<HTMLElement | null>(null);
  return (
    <PortalContainerContext.Provider value={container}>
      {children}
      {/* No box of its own: never a grid or flex item, so no extra gap. */}
      <div
        ref={setContainer}
        data-slot="portal-container"
        style={{ display: 'contents' }}
      />
    </PortalContainerContext.Provider>
  );
}
