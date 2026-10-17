import * as nodeNet from 'node:net';
import { describe, expect, it } from 'vite-plus/test';
import { isIP, isIPv4, isIPv6 } from './net.ts';

// Addresses on and around every edge node:net draws: leading zeros, octet
// bounds, compression, embedded IPv4, zones, case and stray characters.
const SAMPLES = [
  '',
  ' ',
  '0.0.0.0',
  '1.2.3.4',
  '255.255.255.255',
  '256.1.1.1',
  '1.2.3',
  '1.2.3.4.5',
  '01.2.3.4',
  '1.2.3.04',
  '1.2.3.4 ',
  ' 1.2.3.4',
  '1..3.4',
  '1.2.3.-4',
  '1.2.3.4/8',
  '1e1.2.3.4',
  '०.1.2.3',
  '::',
  '::1',
  '1::',
  '::ffff:1.2.3.4',
  '::ffff:01.2.3.4',
  '::ffff:256.2.3.4',
  '1:2:3:4:5:6:7:8',
  '1:2:3:4:5:6:7:8:9',
  '1:2:3:4:5:6:7',
  '1:2:3:4:5:6:7::',
  '::2:3:4:5:6:7:8',
  '1::8',
  '1:2::7:8',
  '1::2::3',
  ':::',
  ':1::',
  '1:',
  ':1',
  'fe80::1%eth0',
  'fe80::1%',
  'fe80::1%en0.1',
  'fe80::1%a:b',
  'fe80::1%a_b',
  'fe80::1%a b',
  'FE80::ABCD',
  'fe80::abcd',
  'g::1',
  '12345::1',
  '1:2:3:4:5:6:1.2.3.4',
  '1:2:3:4:5:1.2.3.4',
  '1:2:3:4:5:6:7:1.2.3.4',
  '1::1.2.3.4',
  '::1.2.3.4',
  '1.2.3.4::',
  '2001:db8::',
  '2001:0db8:0000:0000:0000:ff00:0042:8329',
  '2001:db8:0:0:0:0:2:1',
  '[::1]',
  'localhost',
  'example.com',
  '1:2:3:4:5:6:7:8%1',
  '::%1',
];

/** Every string of up to `length` characters from `alphabet`. */
function* strings(alphabet: string, length: number): Generator<string> {
  if (length === 0) {
    yield '';
    return;
  }
  for (const shorter of strings(alphabet, length - 1)) {
    yield shorter;
    for (const char of alphabet) yield shorter + char;
  }
}

describe('the pure IP checks', () => {
  it.each(SAMPLES)('agree with node:net on %j', (text) => {
    expect(isIPv4(text)).toBe(nodeNet.isIPv4(text));
    expect(isIPv6(text)).toBe(nodeNet.isIPv6(text));
    expect(isIP(text)).toBe(nodeNet.isIP(text));
  });

  it('agree with node:net on every short string of address characters', () => {
    const seen = new Set<string>();
    for (const text of strings(':1.f%', 6)) {
      if (seen.has(text)) continue;
      seen.add(text);
      expect([text, isIPv6(text)]).toEqual([text, nodeNet.isIPv6(text)]);
      expect([text, isIPv4(text)]).toEqual([text, nodeNet.isIPv4(text)]);
    }
  });
});
