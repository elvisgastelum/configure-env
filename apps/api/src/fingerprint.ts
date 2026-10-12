// The fingerprints a write names to say what it was based on: an edit made
// from an outdated view of a file is refused (409) instead of overwriting a
// change made meanwhile.

import { schemaFingerprint } from '@configure-env/core';

/**
 * A file's fingerprint: `sha256:` and the hex digest of its bytes, as the
 * schema writer computes it; null for a file that does not exist.
 */
export const contentFingerprint = (text: string | undefined): string | null =>
  text === undefined ? null : schemaFingerprint(text);
