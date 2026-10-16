// IP addresses and CIDR blocks as bytes: parsing for the ipv6, ip and cidr
// types, and the network math the `within` rule needs. Error messages
// describe the rule, never the value.

import { isIPv4, isIPv6 } from './net.ts';

/** The address families a cidr variable can require. */
export const CIDR_FAMILIES = ['ipv4', 'ipv6', 'any'] as const;

export type CidrFamily = (typeof CIDR_FAMILIES)[number];

/** An address: its family and its bytes, 4 or 16 of them. */
export interface Address {
  family: 4 | 6;
  bytes: number[];
}

/** A CIDR block: its address and prefix length, as written. */
export interface Network extends Address {
  prefix: number;
}

/** The bits in an address of the family. */
const bitsOf = (family: 4 | 6) => (family === 4 ? 32 : 128);

/** The 16 bytes of an IPv6 address that `isIPv6` accepts, without a zone. */
function ipv6Bytes(text: string): number[] {
  // A trailing dotted quad (`::ffff:1.2.3.4`) is the last two groups.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  let groups = text;
  if (tail.includes('.')) {
    const [a = 0, b = 0, c = 0, d = 0] = tail.split('.').map(Number);
    groups = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', rest] = groups.split('::');
  const words = (part: string) =>
    part ? part.split(':').map((word) => parseInt(word, 16)) : [];
  const left = words(head);
  const right = rest === undefined ? [] : words(rest);
  const all =
    rest === undefined
      ? left
      : [
          ...left,
          ...Array<number>(8 - left.length - right.length).fill(0),
          ...right,
        ];
  return all.flatMap((word) => [word >> 8, word & 0xff]);
}

/**
 * The address, or undefined when `text` is not one. IPv4 takes four decimal
 * octets with no leading zero, as the ipv4 type does; IPv6 takes no zone
 * (`%eth0`), since a zone names a host's interface, not an address.
 */
export function parseAddress(text: string): Address | undefined {
  if (isIPv4(text)) return { family: 4, bytes: text.split('.').map(Number) };
  if (text.includes('%') || !isIPv6(text)) return undefined;
  return { family: 6, bytes: ipv6Bytes(text) };
}

const PREFIX = /^(?:0|[1-9]\d{0,2})$/;

const CIDR_EXAMPLE: Record<CidrFamily, string> = {
  ipv4: 'an IPv4 CIDR block, like 10.0.0.0/8',
  ipv6: 'an IPv6 CIDR block, like fd00::/8',
  any: 'a CIDR block, like 10.0.0.0/8 or fd00::/8',
};

export type CidrResult =
  { ok: true; network: Network } | { ok: false; error: string };

/**
 * The CIDR block `address/prefix` of the family, or why `text` is not one:
 * a valid address, a decimal prefix with no sign or leading zero, at most
 * the address's bits.
 */
export function parseCidr(text: string, family: CidrFamily): CidrResult {
  const fail = (error: string): CidrResult => ({ ok: false, error });
  const parts = text.split('/');
  const address = parts.length === 2 ? parseAddress(parts[0]!) : undefined;
  if (
    !address ||
    !PREFIX.test(parts[1]!) ||
    (family !== 'any' && `ipv${address.family}` !== family)
  )
    return fail(`must be ${CIDR_EXAMPLE[family]}`);
  const prefix = Number(parts[1]);
  const bits = bitsOf(address.family);
  if (prefix > bits) return fail(`the prefix length must be at most ${bits}`);
  return { ok: true, network: { ...address, prefix } };
}

/** The bytes with every bit past `prefix` cleared. */
function masked(bytes: readonly number[], prefix: number): number[] {
  return bytes.map((byte, index) => {
    const kept = Math.min(Math.max(prefix - index * 8, 0), 8);
    return byte & (0xff << (8 - kept)) & 0xff;
  });
}

/** Whether the block's address has bits set past its prefix. */
export const hasHostBits = (network: Network) =>
  masked(network.bytes, network.prefix).some(
    (byte, index) => byte !== network.bytes[index],
  );

/**
 * The address as text: dotted decimal, or IPv6 in the RFC 5952 form
 * (lowercase, the longest run of two or more zero groups as `::`).
 */
export function formatAddress({ family, bytes }: Address): string {
  if (family === 4) return bytes.join('.');
  const words = Array.from(
    { length: 8 },
    (_, index) => (bytes[index * 2]! << 8) | bytes[index * 2 + 1]!,
  );
  let start = -1;
  let length = 0;
  for (let index = 0; index < 8;) {
    if (words[index] !== 0) {
      index++;
      continue;
    }
    let end = index;
    while (end < 8 && words[end] === 0) end++;
    if (end - index > length) [start, length] = [index, end - index];
    index = end;
  }
  const hex = (part: number[]) => part.map((word) => word.toString(16));
  if (length < 2) return hex(words).join(':');
  const head = hex(words.slice(0, start)).join(':');
  const tail = hex(words.slice(start + length)).join(':');
  return `${head}::${tail}`;
}

/** The block's network: its address with the host bits cleared. */
export const networkOf = (network: Network): Network => ({
  ...network,
  bytes: masked(network.bytes, network.prefix),
});

/** The block as `address/prefix`. */
export const formatNetwork = (network: Network) =>
  `${formatAddress(network)}/${network.prefix}`;

/**
 * Whether `inner` (an address, or a block) lies inside `outer`'s network:
 * the same family, a prefix at least as long, and the same leading bits.
 */
export function contains(outer: Network, inner: Address | Network): boolean {
  if (outer.family !== inner.family) return false;
  const prefix = 'prefix' in inner ? inner.prefix : bitsOf(inner.family);
  if (prefix < outer.prefix) return false;
  const a = masked(outer.bytes, outer.prefix);
  const b = masked(inner.bytes, outer.prefix);
  return a.every((byte, index) => byte === b[index]);
}
