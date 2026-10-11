/**
 * Soft brand glows behind a page's content: a wide one under the heading
 * and, on wide screens, a smaller one at the bottom right. Decorative only;
 * its parent must be `relative isolate` so the glows stay behind the page.
 */
export function PageGlow() {
  return (
    <>
      <div
        aria-hidden="true"
        data-testid="page-glow"
        className="pointer-events-none absolute inset-x-0 -top-32 -z-10 mx-auto h-[32rem] max-w-5xl rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--brand)_20%,transparent),transparent)] blur-2xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-0 bottom-0 -z-10 hidden h-96 w-96 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--brand)_12%,transparent),transparent)] blur-3xl md:block"
      />
    </>
  );
}
