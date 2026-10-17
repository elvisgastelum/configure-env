import { describe, expect, it } from 'vite-plus/test';
import { getValue, parseDotenv } from '../engine/dotenv.ts';
import { type VariableSpec, variableSpec } from './definition.ts';
import {
  checkRules,
  formatValue,
  ruleKeys,
  maskValue,
  unquoteValue,
  validateValue,
} from './values.ts';

/** A spec with the definition's defaults applied, as a loaded schema has. */
const spec = (input: Record<string, unknown>): VariableSpec =>
  variableSpec.parse(input);

const ok = (value: unknown) => ({ ok: true, value });
const fails = (message: string | RegExp) => ({
  ok: false,
  error: expect.stringMatching(message),
});

describe('validateValue', () => {
  describe('empty and missing values', () => {
    const optional = spec({ type: 'port' });
    const required = spec({ type: 'port', required: true });

    it('accepts a missing optional value as null', () => {
      expect(validateValue(optional, undefined)).toEqual(ok(null));
    });

    it('accepts an empty optional value as null', () => {
      expect(validateValue(optional, '')).toEqual(ok(null));
    });

    it('rejects a missing required value', () => {
      expect(validateValue(required, undefined)).toEqual(fails(/required/));
    });

    it('rejects an empty required value', () => {
      expect(validateValue(required, '')).toEqual(fails(/required/));
    });

    it('accepts an empty required value when allowEmpty is set', () => {
      const lenient = spec({ type: 'port', required: true, allowEmpty: true });
      expect(validateValue(lenient, '')).toEqual(ok(null));
      expect(validateValue(lenient, undefined)).toEqual(fails(/required/));
    });

    it('rejects an empty optional value when allowEmpty is false', () => {
      const strict = spec({ type: 'string', allowEmpty: false });
      expect(validateValue(strict, '')).toEqual(fails(/empty/));
      expect(validateValue(strict, undefined)).toEqual(ok(null));
    });
  });

  describe('string', () => {
    const s = spec({
      type: 'string',
      minLength: 2,
      maxLength: 4,
      pattern: '^[a-z]+$',
    });

    it.each(['ab', 'abcd'])('accepts %j', (raw) => {
      expect(validateValue(s, raw)).toEqual(ok(raw));
    });

    it.each([
      ['a', /at least 2/],
      ['abcde', /at most 4/],
      ['AB', /must match/],
    ])('rejects %j', (raw, message) => {
      expect(validateValue(s, raw)).toEqual(fails(message));
    });

    it('uses patternMessage for a pattern mismatch', () => {
      const whatsapp = spec({
        type: 'string',
        pattern: '^(\\d{8,15}|off)?$',
        patternMessage: 'digits or off',
      });
      expect(validateValue(whatsapp, '5215555555555')).toEqual(
        ok('5215555555555'),
      );
      expect(validateValue(whatsapp, 'call me')).toEqual(
        fails(/digits or off/),
      );
    });

    it('counts characters, not UTF-16 units', () => {
      expect(
        validateValue(spec({ type: 'string', maxLength: 2 }), '😀😀'),
      ).toEqual(ok('😀😀'));
    });
  });

  describe('string encoding and bytes', () => {
    const key = Buffer.alloc(32, 0xfb);
    const base64 = spec({ type: 'string', encoding: 'base64', bytes: 32 });
    const base64url = spec({ type: 'string', encoding: 'base64url' });
    const hex = spec({ type: 'string', encoding: 'hex', bytes: 4 });

    it('accepts canonical base64 of the byte count', () => {
      const value = key.toString('base64');
      expect(value).toMatch(/[+/=]/);
      expect(validateValue(base64, value)).toEqual(ok(value));
    });

    it.each([
      ['the wrong byte count', Buffer.alloc(31).toString('base64')],
      ['missing padding', key.toString('base64').replace(/=+$/, '')],
      ['the base64url alphabet', key.toString('base64url') + '='],
      ['a line break', `${key.toString('base64')}\n`],
      ['non-zero padding bits', 'AB=='],
      ['other characters', 'not base64!'],
    ])('rejects base64 with %s', (_label, raw) => {
      expect(validateValue(base64, raw)).toEqual(
        fails(/^must be base64 that decodes to 32 bytes$/),
      );
    });

    it('accepts base64url without padding, of any length without bytes', () => {
      const value = key.toString('base64url');
      expect(validateValue(base64url, value)).toEqual(ok(value));
      expect(validateValue(base64url, 'AQ')).toEqual(ok('AQ'));
      expect(validateValue(base64url, `${value}=`)).toEqual(
        fails(/^must be base64url$/),
      );
      expect(validateValue(base64url, key.toString('base64'))).toEqual(
        fails(/^must be base64url$/),
      );
    });

    it('accepts hex of either case with an even length', () => {
      expect(validateValue(hex, 'deadBEEF')).toEqual(ok('deadBEEF'));
      for (const raw of ['deadbee', 'deadbeefaa', 'deadbeeg'])
        expect(validateValue(hex, raw)).toEqual(
          fails(/^must be hex that decodes to 4 bytes$/),
        );
    });

    it('applies minLength, maxLength and pattern too', () => {
      const both = spec({ type: 'string', encoding: 'hex', pattern: '^a' });
      expect(validateValue(both, 'b0')).toEqual(fails(/must match/));
      expect(validateValue(both, 'a0')).toEqual(ok('a0'));
    });

    it('never echoes the value in an error', () => {
      const result = validateValue(base64, 'c2VjcmV0LXZhbHVl');
      expect(JSON.stringify(result)).not.toContain('c2VjcmV0LXZhbHVl');
    });
  });

  describe('number', () => {
    const n = spec({ type: 'number', min: -1, max: 10 });

    it.each([
      ['0', 0],
      ['-1', -1],
      ['2.5', 2.5],
      ['.5', 0.5],
      ['1e1', 10],
    ])('accepts %j as %j', (raw, value) => {
      expect(validateValue(n, raw)).toEqual(ok(value));
    });

    it.each([
      ['abc', /must be a number/],
      [' 1', /must be a number/],
      ['0x10', /must be a number/],
      ['Infinity', /must be a number/],
      ['-2', /at least -1/],
      ['11', /at most 10/],
    ])('rejects %j', (raw, message) => {
      expect(validateValue(n, raw)).toEqual(fails(message));
    });
  });

  describe('integer', () => {
    const i = spec({ type: 'integer', min: 1 });

    it.each([
      ['1', 1],
      ['+42', 42],
    ])('accepts %j as %j', (raw, value) => {
      expect(validateValue(i, raw)).toEqual(ok(value));
    });

    it.each([
      ['1.5', /whole number/],
      ['0', /at least 1/],
      ['99999999999999999999', /whole number/],
    ])('rejects %j', (raw, message) => {
      expect(validateValue(i, raw)).toEqual(fails(message));
    });
  });

  describe('boolean', () => {
    const b = spec({ type: 'boolean' });

    it.each([
      ['true', true],
      ['FALSE', false],
      ['1', true],
      ['0', false],
      ['yes', true],
      ['no', false],
      ['on', true],
      ['off', false],
    ])('accepts %j as %j', (raw, value) => {
      expect(validateValue(b, raw)).toEqual(ok(value));
    });

    it('rejects anything else', () => {
      expect(validateValue(b, 'maybe')).toEqual(fails(/true or false/));
    });
  });

  describe('enum', () => {
    const e = spec({ type: 'enum', values: ['dev', 'prod'] });

    it('accepts a listed value', () => {
      expect(validateValue(e, 'prod')).toEqual(ok('prod'));
    });

    it('rejects an unlisted value, case-sensitively', () => {
      expect(validateValue(e, 'Prod')).toEqual(fails(/one of dev, prod/));
    });
  });

  describe('email', () => {
    const email = spec({ type: 'email' });

    it('accepts an address', () => {
      expect(validateValue(email, 'you@example.com')).toEqual(
        ok('you@example.com'),
      );
    });

    it.each(['you', 'you@', '@example.com'])('rejects %j', (raw) => {
      expect(validateValue(email, raw)).toEqual(fails(/email/));
    });
  });

  describe('url', () => {
    it('accepts any absolute URL without protocols', () => {
      const url = spec({ type: 'url' });
      expect(validateValue(url, 'ftp://files.example.com')).toEqual(
        ok('ftp://files.example.com'),
      );
      expect(validateValue(url, 'example.com')).toEqual(fails(/URL/));
    });

    it('limits the protocols when given', () => {
      const url = spec({ type: 'url', protocols: ['http', 'https:'] });
      expect(validateValue(url, 'https://example.com')).toEqual(
        ok('https://example.com'),
      );
      expect(validateValue(url, 'ftp://example.com')).toEqual(
        fails(/http, https/),
      );
    });
  });

  describe('host', () => {
    const host = spec({ type: 'host' });

    it.each(['localhost', 'web.internal', '192.168.1.70', '::1', 'fd7a::1'])(
      'accepts %j',
      (raw) => {
        expect(validateValue(host, raw)).toEqual(ok(raw));
      },
    );

    it.each(['1.2.3.4', 'web1.example', '123.example', 'web.internal1'])(
      'accepts %j, whose last label is not all digits or which is IPv4',
      (raw) => {
        expect(validateValue(host, raw)).toEqual(ok(raw));
      },
    );

    it.each([
      'bad host',
      '-leading.dash',
      'trailing-.dash',
      'a'.repeat(64),
      '999.1.1.1',
      '1.2.3',
      '123',
      'web.123',
    ])('rejects %j', (raw) => {
      expect(validateValue(host, raw)).toEqual(fails(/hostname/));
    });
  });

  describe('ipv4', () => {
    const ipv4 = spec({ type: 'ipv4' });

    it('accepts an address', () => {
      expect(validateValue(ipv4, '100.64.0.1')).toEqual(ok('100.64.0.1'));
    });

    it.each(['256.0.0.1', '1.2.3', 'localhost', '::1'])('rejects %j', (raw) => {
      expect(validateValue(ipv4, raw)).toEqual(fails(/IPv4/));
    });
  });

  describe('ipv6', () => {
    const ipv6 = spec({ type: 'ipv6' });

    it.each([
      '::1',
      '::',
      'fd00::10',
      '2001:db8:0:0:0:0:0:1',
      '::ffff:1.2.3.4',
    ])('accepts %j', (raw) => {
      expect(validateValue(ipv6, raw)).toEqual(ok(raw));
    });

    it.each([
      '1.2.3.4',
      '1::2::3',
      'fe80::1%eth0',
      '2001:db8::g',
      'localhost',
      '12345::',
    ])('rejects %j', (raw) => {
      expect(validateValue(ipv6, raw)).toEqual(fails(/IPv6/));
    });
  });

  describe('ip', () => {
    const ip = spec({ type: 'ip' });

    it.each(['10.0.0.1', '::1', 'fd00::10'])('accepts %j', (raw) => {
      expect(validateValue(ip, raw)).toEqual(ok(raw));
    });

    it.each(['256.0.0.1', '01.2.3.4', '1::2::3', 'fe80::1%eth0', 'host'])(
      'rejects %j',
      (raw) => {
        expect(validateValue(ip, raw)).toEqual(fails(/IPv4 or IPv6/));
      },
    );
  });

  describe('cidr', () => {
    const any = spec({ type: 'cidr' });
    const v4 = spec({ type: 'cidr', family: 'ipv4' });
    const v6 = spec({ type: 'cidr', family: 'ipv6' });

    it('defaults to either family, not strict', () => {
      expect(any).toMatchObject({ family: 'any', strict: false });
    });

    it.each([
      '10.0.0.0/8',
      '172.30.250.0/24',
      '0.0.0.0/0',
      '1.2.3.4/32',
      '172.30.250.10/24',
      'fd00::/8',
      '2001:db8::1/128',
      '::/0',
    ])('accepts %j in either family', (raw) => {
      expect(validateValue(any, raw)).toEqual(ok(raw));
    });

    it.each([
      ['an octet over 255', '256.0.0.0/8'],
      ['a leading zero in an octet', '010.0.0.0/8'],
      ['no prefix', '10.0.0.0'],
      ['an empty prefix', '10.0.0.0/'],
      ['a non-numeric prefix', '10.0.0.0/x'],
      ['a signed prefix', '10.0.0.0/+8'],
      ['a leading zero in the prefix', '10.0.0.0/08'],
      ['two prefixes', '10.0.0.0/8/8'],
      ['no address', '/8'],
      ['a hostname', 'localhost/8'],
      ['an IPv6 zone', 'fe80::%eth0/64'],
      ['spaces', ' 10.0.0.0/8'],
    ])('rejects %s', (_label, raw) => {
      expect(validateValue(any, raw)).toEqual(fails(/CIDR block/));
    });

    it('rejects a prefix over the address length', () => {
      expect(validateValue(any, '10.0.0.0/33')).toEqual(fails(/at most 32/));
      expect(validateValue(any, 'fd00::/129')).toEqual(fails(/at most 128/));
      expect(validateValue(v4, '10.0.0.0/32')).toEqual(ok('10.0.0.0/32'));
      expect(validateValue(v6, 'fd00::/128')).toEqual(ok('fd00::/128'));
    });

    it('rejects the other family', () => {
      expect(validateValue(v4, 'fd00::/8')).toEqual(fails(/IPv4 CIDR block/));
      expect(validateValue(v6, '10.0.0.0/8')).toEqual(fails(/IPv6 CIDR block/));
      expect(validateValue(v4, '10.0.0.0/8')).toEqual(ok('10.0.0.0/8'));
      expect(validateValue(v6, 'fd00::/8')).toEqual(ok('fd00::/8'));
    });

    describe('strict', () => {
      const strict = spec({ type: 'cidr', strict: true });

      it('accepts a network address', () => {
        expect(validateValue(strict, '172.30.250.0/24')).toEqual(
          ok('172.30.250.0/24'),
        );
        expect(validateValue(strict, 'fd00::/8')).toEqual(ok('fd00::/8'));
        expect(validateValue(strict, '0.0.0.0/0')).toEqual(ok('0.0.0.0/0'));
        expect(validateValue(strict, '1.2.3.4/32')).toEqual(ok('1.2.3.4/32'));
      });

      it('refuses host bits and suggests the network address', () => {
        expect(validateValue(strict, '172.30.250.10/24')).toEqual({
          ok: false,
          error: 'host bits are set; use 172.30.250.0/24',
        });
        expect(validateValue(strict, '10.1.2.3/12')).toEqual({
          ok: false,
          error: 'host bits are set; use 10.0.0.0/12',
        });
        expect(validateValue(strict, '2001:db8:0:0:1::1/64')).toEqual({
          ok: false,
          error: 'host bits are set; use 2001:db8::/64',
        });
        expect(validateValue(strict, 'fd00:0:0:1::5/48')).toEqual({
          ok: false,
          error: 'host bits are set; use fd00::/48',
        });
      });

      it('never derives the message from a secret value', () => {
        const secret = spec({ type: 'cidr', strict: true, secret: true });
        const result = validateValue(secret, '172.30.250.10/24');
        expect(result).toEqual({
          ok: false,
          error: 'host bits are set; use the network address',
        });
        expect(JSON.stringify(result)).not.toContain('172.30');
      });
    });
  });

  describe('port', () => {
    const port = spec({ type: 'port' });

    it.each([
      ['1', 1],
      ['8080', 8080],
      ['65535', 65535],
    ])('accepts %j as %j', (raw, value) => {
      expect(validateValue(port, raw)).toEqual(ok(value));
    });

    it.each(['0', '65536', '80.5', 'http', '-1'])('rejects %j', (raw) => {
      expect(validateValue(port, raw)).toEqual(fails(/1 and 65535/));
    });
  });

  describe('secrets', () => {
    it('never echoes the value in an error', () => {
      const token = spec({ type: 'string', secret: true, minLength: 20 });
      const result = validateValue(token, 'hunter2-hunter2');
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain('hunter2');
    });
  });
});

describe('formatValue', () => {
  const text = spec({ type: 'string' });

  it.each([
    [spec({ type: 'boolean' }), true, 'true'],
    [spec({ type: 'boolean' }), false, 'false'],
    [spec({ type: 'port' }), 8080, '8080'],
    [spec({ type: 'number' }), 0.5, '0.5'],
    [text, null, ''],
    [text, '', ''],
    [text, 'plain', 'plain'],
    [
      text,
      'docker-compose.yml:deploy/compose.prod.yml',
      'docker-compose.yml:deploy/compose.prod.yml',
    ],
    [text, 'C:\\path', 'C:\\path'],
  ])('writes %#: %j as %s', (s, value, expected) => {
    expect(formatValue(s, value)).toBe(expected);
  });

  it.each([
    ['two words', '"two words"'],
    [' leading', '" leading"'],
    ['a#b', '"a#b"'],
    ['say "hi"', '"say \\"hi\\""'],
    ["it's", '"it\'s"'],
    ['back`tick', '"back`tick"'],
    ['line\nbreak', '"line\\nbreak"'],
    ['cr\rlf', '"cr\\rlf"'],
    ['tab\there', '"tab\\there"'],
    ['quoted \\ slash', '"quoted \\\\ slash"'],
  ])('quotes %j as %s', (value, expected) => {
    expect(formatValue(text, value)).toBe(expected);
  });

  it.each([
    ['pa$$word', "'pa$$word'"],
    ['${HOME}/x', "'${HOME}/x'"],
    ['$ two words', "'$ two words'"],
    ["it's $5", '"it\'s \\$5"'],
    ['$line\nbreak', '"\\$line\\nbreak"'],
  ])('keeps %j from interpolation as %s', (value, expected) => {
    expect(formatValue(text, value)).toBe(expected);
  });

  it.each([
    'plain',
    'two words',
    ' padded ',
    'a#b',
    'say "hi"',
    "it's",
    'multi\nline\r\nvalue',
    'tab\tand \\ slash',
    'C:\\no\\quotes',
    '"already quoted"',
    "'single'",
    '\\n literal',
    'pa$$word',
    "it's $5",
    '$multi\nline',
    '\\$ literal backslash',
    '',
  ])('round-trips %j', (value) => {
    expect(unquoteValue(formatValue(text, value))).toBe(value);
  });

  it('writes base64 plain, and a reader gets it back unchanged', () => {
    const base64 = spec({ type: 'string', encoding: 'base64', bytes: 32 });
    const value = Buffer.alloc(32, 0xfb).toString('base64');
    const written = formatValue(base64, value);
    expect(written).toBe(value);
    const doc = parseDotenv(`KEY=${written}\n`);
    expect(getValue(doc, 'KEY')).toBe(value);
  });
});

describe('unquoteValue', () => {
  it.each([
    ['plain', 'plain'],
    ['"a \\"b\\" c"', 'a "b" c'],
    ["'kept \\n as is'", 'kept \\n as is'],
    ['"unknown \\q escape"', 'unknown \\q escape'],
    ['"unterminated', '"unterminated'],
  ])('reads %s as %j', (raw, expected) => {
    expect(unquoteValue(raw)).toBe(expected);
  });
});

describe('maskValue', () => {
  const secret = spec({ type: 'string', secret: true });

  it('masks all but the last 2 characters of a long secret', () => {
    expect(maskValue(secret, 'abcdefghij')).toBe('••••ij');
  });

  it('masks a short secret entirely', () => {
    expect(maskValue(secret, 'abcdefgh')).toBe('••••••••');
    expect(maskValue(secret, 'abc')).toBe('•••');
  });

  it('shows nothing for an empty secret', () => {
    expect(maskValue(secret, null)).toBe('');
    expect(maskValue(secret, '')).toBe('');
  });

  it('masks a typed secret by its written form', () => {
    const pin = spec({ type: 'integer', secret: true });
    expect(maskValue(pin, 123456789)).toBe('••••89');
  });

  it('shows a value that is not secret as written', () => {
    expect(maskValue(spec({ type: 'string' }), 'two words')).toBe('two words');
    expect(maskValue(spec({ type: 'port' }), 8080)).toBe('8080');
  });
});

describe('checkRules', () => {
  const variables = {
    A: spec({
      type: 'string',
      requiredUnless: ['B', 'C'],
      conflictsWith: 'B',
      distinctFrom: 'C',
    }),
    B: spec({ type: 'string', conflictsWith: ['A'] }),
    C: spec({ type: 'string' }),
  };
  const rules = (
    values: Record<string, string>,
    keys: string[] = ['A', 'B', 'C'],
  ) => checkRules(variables, keys, (key) => values[key]);

  it('requires a variable unless one of the others is set, empty counting as unset', () => {
    const problem = {
      rule: 'requiredUnless',
      key: 'A',
      others: ['B', 'C'],
      message: 'required unless B or C is set',
    };
    expect(rules({})).toEqual([problem]);
    expect(rules({ A: '', B: '' })).toEqual([problem]);
    expect(rules({ C: 'x' })).toEqual([]);
    expect(rules({ A: 'x' })).toEqual([]);
  });

  it('reports a conflict once per pair, even when both sides declare it', () => {
    const problems = rules({ A: '1', B: '2' });
    expect(problems).toEqual([
      {
        rule: 'conflictsWith',
        key: 'A',
        others: ['B'],
        message: 'set only one of them',
      },
    ]);
    expect(ruleKeys(problems[0]!)).toEqual(['A', 'B']);
    expect(rules({ A: '1', B: '' })).toEqual([]);
  });

  it('requires different values when both are set', () => {
    const problems = rules({ A: 'same', C: 'same' });
    expect(problems).toEqual([
      {
        rule: 'distinctFrom',
        key: 'A',
        others: ['C'],
        message: 'must differ from C',
      },
    ]);
    expect(ruleKeys(problems[0]!)).toEqual(['A']);
    expect(JSON.stringify(problems)).not.toContain('same');
    expect(rules({ A: 'one', C: 'two' })).toEqual([]);
  });

  it('ignores the names a file does not list', () => {
    expect(rules({}, ['A'])).toEqual([]);
    expect(rules({ A: 'x', C: 'x' }, ['A', 'B'])).toEqual([]);
    expect(rules({}, ['A', 'C'])).toEqual([
      expect.objectContaining({ message: 'required unless C is set' }),
    ]);
  });
});

describe('checkRules within', () => {
  const variables = {
    SUBNET: spec({ type: 'cidr' }),
    SUBNET4: spec({ type: 'cidr', family: 'ipv4' }),
    ADDRESS: spec({ type: 'ip', within: 'SUBNET' }),
    ADDRESS4: spec({ type: 'ipv4', within: 'SUBNET' }),
    ADDRESS6: spec({ type: 'ipv6', within: 'SUBNET' }),
    BLOCK: spec({ type: 'cidr', within: 'SUBNET' }),
    SECRET: spec({ type: 'ip', secret: true, within: 'SUBNET' }),
  };
  const rules = (values: Record<string, string>) =>
    checkRules(variables, Object.keys(values), (key) => values[key]);
  const outside = (key: string) => [
    {
      rule: 'within',
      key,
      others: ['SUBNET'],
      message: 'must be within SUBNET',
    },
  ];

  it.each([
    ['ADDRESS4', '172.30.250.10', '172.30.250.0/24'],
    ['ADDRESS4', '172.30.250.0', '172.30.250.0/24'],
    ['ADDRESS4', '172.30.250.255', '172.30.250.0/24'],
    ['ADDRESS4', '8.8.8.8', '0.0.0.0/0'],
    ['ADDRESS4', '10.1.2.3', '10.1.2.3/32'],
    ['ADDRESS6', 'fd00::10', 'fd00::/8'],
    ['ADDRESS6', '2001:db8::1', '2001:db8::/32'],
    ['ADDRESS', '::ffff:10.0.0.1', '::ffff:0:0/96'],
    ['ADDRESS', '172.30.250.10', '172.30.250.99/24'],
    ['BLOCK', '172.30.250.128/25', '172.30.250.0/24'],
    ['BLOCK', '172.30.250.0/24', '172.30.250.0/24'],
    ['BLOCK', 'fd00:1::/32', 'fd00::/16'],
  ])('passes %s=%j within %j', (key, value, subnet) => {
    expect(rules({ [key]: value, SUBNET: subnet })).toEqual([]);
  });

  it.each([
    ['ADDRESS4', '172.30.251.10', '172.30.250.0/24'],
    ['ADDRESS4', '10.1.2.4', '10.1.2.3/32'],
    ['ADDRESS6', 'fd01::10', 'fd00::/16'],
    ['ADDRESS', '10.0.0.1', 'fd00::/8'],
    ['ADDRESS', 'fd00::1', '10.0.0.0/8'],
    ['BLOCK', '172.30.0.0/16', '172.30.250.0/24'],
    ['BLOCK', '172.30.251.0/24', '172.30.250.0/24'],
    ['BLOCK', 'fd00::/8', '10.0.0.0/8'],
  ])('fails %s=%j outside %j, naming keys only', (key, value, subnet) => {
    const problems = rules({ [key]: value, SUBNET: subnet });
    expect(problems).toEqual(outside(key));
    expect(ruleKeys(problems[0]!)).toEqual([key]);
    const text = JSON.stringify(problems);
    expect(text).not.toContain(value);
    expect(text).not.toContain(subnet);
  });

  it('applies only when both values are set and valid', () => {
    expect(rules({ ADDRESS4: '', SUBNET: '10.0.0.0/8' })).toEqual([]);
    expect(rules({ ADDRESS4: '172.16.0.1', SUBNET: '' })).toEqual([]);
    expect(rules({ ADDRESS4: '172.16.0.1' })).toEqual([]);
    expect(rules({ ADDRESS4: 'nope', SUBNET: '10.0.0.0/8' })).toEqual([]);
    expect(rules({ ADDRESS4: '172.16.0.1', SUBNET: '10.0.0.0' })).toEqual([]);
    expect(rules({ ADDRESS4: 'fd00::1', SUBNET: '10.0.0.0/8' })).toEqual([]);
  });

  it('never echoes a secret value', () => {
    const problems = rules({ SECRET: '192.168.7.7', SUBNET: '10.0.0.0/8' });
    expect(problems).toEqual(outside('SECRET'));
    expect(JSON.stringify(problems)).not.toMatch(/192\.168|10\.0/);
  });

  it('checks a target of one family', () => {
    const only4 = {
      ...variables,
      ADDRESS: spec({ type: 'ip', within: 'SUBNET4' }),
    };
    const values = { ADDRESS: '10.0.0.1', SUBNET4: '10.0.0.0/8' };
    expect(
      checkRules(only4, Object.keys(values), (key) => values[key as 'ADDRESS']),
    ).toEqual([]);
  });

  it('skips a target the variables do not declare', () => {
    const missing = { ADDRESS: spec({ type: 'ip', within: 'NOWHERE' }) };
    const values = { ADDRESS: '10.0.0.1', NOWHERE: '10.0.0.0/8' };
    expect(
      checkRules(
        missing,
        Object.keys(values),
        (key) => values[key as 'ADDRESS'],
      ),
    ).toEqual([]);
  });
});
