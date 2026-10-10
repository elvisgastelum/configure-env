import { z } from 'zod';
import type { EnvValues } from './template.ts';

// An RFC 1123 hostname: dot-separated labels of letters, digits and inner
// hyphens, each at most 63 characters.
const HOSTNAME =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

export const webHost = z.union([z.ipv4(), z.string().regex(HOSTNAME)], {
  error: 'must be an IPv4 address or a hostname',
});

export const webPort = z
  .string()
  .regex(/^\d+$/, 'must be a number')
  .refine((value) => Number(value) >= 1 && Number(value) <= 65535, {
    error: 'must be between 1 and 65535',
  });

export const contactEmail = z.union([z.literal(''), z.email()], {
  error: 'must be an email address, or empty for the default',
});

export const contactWhatsapp = z.union(
  [z.literal(''), z.literal('off'), z.string().regex(/^\d+$/)],
  {
    error:
      'must be digits (country code first), `off`, or empty for the default',
  },
);

export const envValuesSchema = z.object({
  WEB_HOST: webHost,
  WEB_PORT: webPort,
  VITE_CONTACT_EMAIL: contactEmail,
  VITE_CONTACT_WHATSAPP: contactWhatsapp,
});

export type ValidationResult =
  { ok: true; values: EnvValues } | { ok: false; errors: string[] };

/** Checks the values; each error reads `KEY: problem`. */
export function validateValues(values: EnvValues): ValidationResult {
  const result = envValuesSchema.safeParse(values);
  if (result.success) return { ok: true, values: result.data };
  return {
    ok: false,
    errors: result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    ),
  };
}

/** A clack `validate` callback: the message on failure, nothing when valid. */
export const promptValidator =
  (schema: z.ZodType) =>
  (value: string | undefined): string | undefined => {
    const result = schema.safeParse(value ?? '');
    return result.success ? undefined : result.error.issues[0]?.message;
  };
