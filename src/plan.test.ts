import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EXAMPLE_PATH,
  LOCAL_PATH,
  PRODUCTION_EXAMPLE_PATH,
  applyPlan,
  checkDrift,
  describeChange,
  planChanges,
} from './plan.ts';
import { DEFAULT_VALUES, renderProductionExample } from './template.ts';

const examples = ['production', 'example'] as const;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'configure-env-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const plan = (targets: Parameters<typeof planChanges>[0]['targets']) =>
  planChanges({ root, targets, values: DEFAULT_VALUES });
const lines = (p: Awaited<ReturnType<typeof planChanges>>) =>
  p.changes.map(describeChange);

describe('planChanges', () => {
  it('creates both examples on a fresh root without writing anything', async () => {
    const p = await plan(examples);
    expect(lines(p)).toEqual([
      `${PRODUCTION_EXAMPLE_PATH}: created`,
      `${EXAMPLE_PATH}: created`,
    ]);
    expect(p.changes[0]?.content).toBe(renderProductionExample());
    expect(p.changes[1]?.content).toContain('WEB_HOST=127.0.0.1\n');
    await expect(stat(join(root, 'deploy'))).rejects.toThrow();
  });

  it('reports a current root unchanged and plans no writes', async () => {
    await applyPlan(root, await plan(examples));
    const p = await plan(examples);
    expect(lines(p)).toEqual([
      `${PRODUCTION_EXAMPLE_PATH}: unchanged`,
      `${EXAMPLE_PATH}: unchanged`,
    ]);
    expect(p.changes.every((c) => c.content === undefined)).toBe(true);
  });

  it('rewrites an edited production example and appends missing example keys', async () => {
    await applyPlan(root, await plan(examples));
    const prod = join(root, PRODUCTION_EXAMPLE_PATH);
    await writeFile(prod, renderProductionExample() + 'EXTRA=1\n');
    await writeFile(join(root, EXAMPLE_PATH), 'CUSTOM=1\nWEB_HOST=10.0.0.5\n');
    const p = await plan(examples);
    expect(lines(p)).toEqual([
      `${PRODUCTION_EXAMPLE_PATH}: updated`,
      `${EXAMPLE_PATH}: added keys: WEB_PORT VITE_CONTACT_EMAIL VITE_CONTACT_WHATSAPP`,
    ]);
    await applyPlan(root, p);
    expect(await readFile(prod, 'utf8')).toBe(renderProductionExample());
    const example = await readFile(join(root, EXAMPLE_PATH), 'utf8');
    expect(example.startsWith('CUSTOM=1\nWEB_HOST=10.0.0.5\n\n')).toBe(true);
  });

  it('plans only the requested targets', async () => {
    expect(lines(await plan(['example']))).toEqual([
      `${EXAMPLE_PATH}: created`,
    ]);
  });
});

describe('local .env', () => {
  it('is created with mode 600 from the given values', async () => {
    const p = await planChanges({
      root,
      targets: ['local'],
      values: { ...DEFAULT_VALUES, WEB_PORT: '9000' },
    });
    expect(lines(p)).toEqual([`${LOCAL_PATH}: created`]);
    await applyPlan(root, p);
    const path = join(root, LOCAL_PATH);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, 'utf8')).toContain('\nWEB_PORT=9000\n');
  });

  it('is never overwritten', async () => {
    const path = join(root, LOCAL_PATH);
    await writeFile(path, 'KEEP_ME=1\n');
    const p = await plan(['local']);
    expect(lines(p)).toEqual([
      `${LOCAL_PATH}: unchanged (exists; never overwritten)`,
    ]);
    await applyPlan(root, p);
    expect(await readFile(path, 'utf8')).toBe('KEEP_ME=1\n');
  });

  it('refuses to replace a .env created after planning', async () => {
    const p = await plan(['local']);
    await writeFile(join(root, LOCAL_PATH), 'RACE=1\n');
    await expect(applyPlan(root, p)).rejects.toThrow();
    expect(await readFile(join(root, LOCAL_PATH), 'utf8')).toBe('RACE=1\n');
  });
});

describe('checkDrift', () => {
  it('reports both files missing on a fresh root and writes nothing', async () => {
    expect(await checkDrift(root)).toEqual({
      drift: true,
      lines: [
        `${PRODUCTION_EXAMPLE_PATH}: missing`,
        `${EXAMPLE_PATH}: missing`,
      ],
    });
    await expect(stat(join(root, 'deploy'))).rejects.toThrow();
  });

  it('passes on a current root', async () => {
    await applyPlan(root, await plan(examples));
    expect(await checkDrift(root)).toEqual({
      drift: false,
      lines: [
        `${PRODUCTION_EXAMPLE_PATH}: current`,
        `${EXAMPLE_PATH}: current`,
      ],
    });
  });

  it('names an edited production example and missing example keys without changing them', async () => {
    await applyPlan(root, await plan(examples));
    const prod = join(root, PRODUCTION_EXAMPLE_PATH);
    const edited = renderProductionExample() + 'EXTRA=1\n';
    await writeFile(prod, edited);
    await mkdir(join(root, 'deploy'), { recursive: true });
    await writeFile(join(root, EXAMPLE_PATH), 'WEB_HOST=1.2.3.4\n');
    expect(await checkDrift(root)).toEqual({
      drift: true,
      lines: [
        `${PRODUCTION_EXAMPLE_PATH}: differs from the template in packages/configure-env/src/template.ts`,
        `${EXAMPLE_PATH}: missing keys: WEB_PORT VITE_CONTACT_EMAIL VITE_CONTACT_WHATSAPP`,
      ],
    });
    expect(await readFile(prod, 'utf8')).toBe(edited);
  });
});
