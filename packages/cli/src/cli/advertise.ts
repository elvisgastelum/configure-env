// `serve --advertise`: announces the running server on the local network
// over mDNS/DNS-SD as a _configure-env._tcp service, so other machines find
// it without knowing its address. The record holds only what a client needs
// to pick and trust the server: its version, a display name, whether it
// serves TLS and the certificate's fingerprint. Never the token, the
// project's root, or a file or variable name.
//
// bonjour-service (pure JS, over multicast-dns) is imported only when a
// server is advertised, so no other command loads it.

import { X509Certificate } from 'node:crypto';
import { hostname } from 'node:os';

/** The DNS-SD service type, without its leading underscore: _configure-env._tcp. */
export const SERVICE_TYPE = 'configure-env';
/** The longest instance name DNS-SD takes, in UTF-8 bytes. */
export const MAX_NAME_BYTES = 63;
/** How long a stop waits for the goodbye packets to go out. */
const STOP_WAIT_MS = 1000;

/** What `serve` advertises: the DNS-SD service and its TXT record. */
export interface AdvertisedService {
  type: typeof SERVICE_TYPE;
  protocol: 'tcp';
  port: number;
  /** The instance name, also the TXT record's `name`. */
  name: string;
  txt: {
    /** The server's version. */
    v: string;
    name: string;
    /** '1' over HTTPS, else '0'. */
    tls: '1' | '0';
    /** The SHA-256 fingerprint of the TLS certificate, when TLS is on. */
    fp?: string;
  };
}

/** A published service; `stop` unpublishes it. */
export interface Advertisement {
  stop(): Promise<void>;
}

/**
 * Publishes `service`; `onError` hears of a failure after it was published.
 * Tests inject one in place of real multicast.
 */
export type Advertiser = (
  service: AdvertisedService,
  onError: (error: Error) => void,
) => Promise<Advertisement>;

/** This machine's name, as the default display name. */
export function defaultServiceName(): string {
  const name = hostname().replace(/\.local$/i, '');
  return truncateUtf8(name, MAX_NAME_BYTES) || 'configure-env';
}

function truncateUtf8(text: string, bytes: number): string {
  let out = '';
  for (const char of text) {
    if (Buffer.byteLength(out + char) > bytes) break;
    out += char;
  }
  return out;
}

/** The service a server on `port` advertises. */
export function advertisedService(options: {
  port: number;
  name: string;
  version: string;
  cert?: Buffer;
}): AdvertisedService {
  const { port, name, version, cert } = options;
  return {
    type: SERVICE_TYPE,
    protocol: 'tcp',
    port,
    name,
    txt: {
      v: version,
      name,
      tls: cert ? '1' : '0',
      ...(cert ? { fp: new X509Certificate(cert).fingerprint256 } : {}),
    },
  };
}

/**
 * The advertiser over bonjour-service. `mdns` goes to multicast-dns, such
 * as `{ interface: '192.168.1.10' }` to use that interface only.
 */
export function bonjourAdvertiser(
  mdns: { interface?: string } = {},
): Advertiser {
  return async (service, onError) => {
    const { Bonjour } = await import('bonjour-service');
    // Its options go to multicast-dns, though its types say ServiceConfig.
    const bonjour = new Bonjour(
      mdns as Record<string, unknown> as ConstructorParameters<
        typeof Bonjour
      >[0],
      (error: Error) => onError(error),
    );
    // No probe: bonjour-service reports a name in use on console.log, which
    // would break --json; a duplicate name is the user's to change.
    bonjour.publish({
      name: service.name,
      type: service.type,
      protocol: service.protocol,
      port: service.port,
      txt: service.txt,
      probe: false,
    });
    return {
      stop: () =>
        new Promise<void>((resolve) => {
          // The goodbye packets go out before the socket closes; a network
          // that swallows them never holds up the stop.
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            bonjour.destroy(() => resolve());
          };
          const timer = setTimeout(finish, STOP_WAIT_MS);
          bonjour.unpublishAll(finish);
        }),
    };
  };
}
