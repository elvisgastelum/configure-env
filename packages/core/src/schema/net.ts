// `isIP`, `isIPv4` and `isIPv6` as node:net defines them, without Node, so
// the schema checks run in the portal too. The patterns are Node's own
// (lib/internal/net.js); net.test.ts checks them against node:net.

const V4_SEGMENT = '(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])';
const V4 = `(?:${V4_SEGMENT}\\.){3}${V4_SEGMENT}`;
const IPV4 = new RegExp(`^${V4}$`);

const V6_SEGMENT = '(?:[0-9a-fA-F]{1,4})';
const IPV6 = new RegExp(
  '^(?:' +
    `(?:${V6_SEGMENT}:){7}(?:${V6_SEGMENT}|:)|` +
    `(?:${V6_SEGMENT}:){6}(?:${V4}|:${V6_SEGMENT}|:)|` +
    `(?:${V6_SEGMENT}:){5}(?::${V4}|(?::${V6_SEGMENT}){1,2}|:)|` +
    `(?:${V6_SEGMENT}:){4}(?:(?::${V6_SEGMENT}){0,1}:${V4}|(?::${V6_SEGMENT}){1,3}|:)|` +
    `(?:${V6_SEGMENT}:){3}(?:(?::${V6_SEGMENT}){0,2}:${V4}|(?::${V6_SEGMENT}){1,4}|:)|` +
    `(?:${V6_SEGMENT}:){2}(?:(?::${V6_SEGMENT}){0,3}:${V4}|(?::${V6_SEGMENT}){1,5}|:)|` +
    `(?:${V6_SEGMENT}:){1}(?:(?::${V6_SEGMENT}){0,4}:${V4}|(?::${V6_SEGMENT}){1,6}|:)|` +
    `(?::(?:(?::${V6_SEGMENT}){0,5}:${V4}|(?::${V6_SEGMENT}){1,7}|:))` +
    ')(?:%[0-9a-zA-Z-.:]{1,})?$',
);

/** Whether `text` is an IPv4 address: four decimal octets, no leading zero. */
export const isIPv4 = (text: string): boolean => IPV4.test(text);

/** Whether `text` is an IPv6 address, with an optional `%zone`. */
export const isIPv6 = (text: string): boolean => IPV6.test(text);

/** 4 for an IPv4 address, 6 for an IPv6 one, else 0. */
export const isIP = (text: string): 0 | 4 | 6 =>
  isIPv4(text) ? 4 : isIPv6(text) ? 6 : 0;
