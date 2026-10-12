import { describe, expect, it } from 'vitest';
import { files, variables } from '../../mocks/fixtures';
import {
  EMPTY_FILTERS,
  type Filters,
  type SortOrder,
  browse,
  matchesQuery,
  sectionsOf,
  statusesOf,
} from './model';

const all = variables.variables;
const names = (filters: Partial<Filters>, sort: SortOrder = 'schema') =>
  browse(all, files.files, { ...EMPTY_FILTERS, ...filters }, sort).flatMap(
    (section) => section.variables.map((variable) => variable.name),
  );
const byName = (name: string) =>
  all.find((variable) => variable.name === name)!;

describe('statusesOf', () => {
  it('reports missing, invalid and drift across every file', () => {
    expect(statusesOf(byName('API_URL'), files.files)).toEqual(['invalid']);
    expect(statusesOf(byName('API_KEY'), files.files)).toEqual([
      'missing',
      'drift',
    ]);
    expect(statusesOf(byName('LOG_LEVEL'), files.files)).toEqual(['missing']);
  });

  it('looks at one file when given', () => {
    expect(statusesOf(byName('LOG_LEVEL'), files.files, '.env')).toEqual([]);
    expect(statusesOf(byName('PORT'), files.files, 'config/app.env')).toEqual([
      'missing',
    ]);
  });
});

describe('matchesQuery', () => {
  it('searches the name, the description and the comment', () => {
    expect(matchesQuery(byName('API_URL'), 'api_u')).toBe(true);
    expect(matchesQuery(byName('API_URL'), 'LIVES')).toBe(true);
    expect(matchesQuery(byName('API_URL'), 'trailing slash')).toBe(true);
    expect(matchesQuery(byName('API_URL'), 'database')).toBe(false);
    expect(matchesQuery(byName('API_URL'), '  ')).toBe(true);
  });
});

describe('browse', () => {
  it('groups in schema order, the ungrouped ones last', () => {
    const sections = sectionsOf(all);
    expect(sections.map((section) => section.group)).toEqual([
      'Network',
      'Database',
      null,
    ]);
    expect(sections[2]!.variables.map((variable) => variable.name)).toEqual([
      'API_KEY',
      'LOG_LEVEL',
    ]);
  });

  it('filters by type, group, flags, file and status', () => {
    expect(names({ type: 'enum' })).toEqual(['LOG_LEVEL']);
    expect(names({ group: 'Network' })).toEqual(['API_URL', 'PORT']);
    expect(names({ group: null })).toEqual(['API_KEY', 'LOG_LEVEL']);
    expect(names({ required: true })).toEqual(['API_URL', 'DB_PASSWORD']);
    expect(names({ secret: true })).toEqual(['DB_PASSWORD', 'API_KEY']);
    expect(names({ protected: true })).toEqual(['DB_PASSWORD']);
    expect(names({ file: 'config/app.env' })).toEqual(['PORT', 'LOG_LEVEL']);
    expect(names({ status: 'invalid' })).toEqual(['API_URL']);
    expect(names({ status: 'drift' })).toEqual(['API_KEY']);
    expect(names({ status: 'missing', file: '.env' })).toEqual(['API_KEY']);
    expect(names({ status: 'ok', file: '.env' })).toEqual([
      'PORT',
      'DB_PASSWORD',
      'LOG_LEVEL',
    ]);
  });

  it('sorts inside each group', () => {
    expect(
      browse(all, files.files, EMPTY_FILTERS, 'name-desc').map((section) =>
        section.variables.map((variable) => variable.name),
      ),
    ).toEqual([['PORT', 'API_URL'], ['DB_PASSWORD'], ['LOG_LEVEL', 'API_KEY']]);
    expect(names({}, 'type')).toEqual([
      'PORT',
      'API_URL',
      'DB_PASSWORD',
      'LOG_LEVEL',
      'API_KEY',
    ]);
  });

  it('sorts the ones with issues first', () => {
    expect(names({}, 'status')).toEqual([
      'API_URL',
      'PORT',
      'DB_PASSWORD',
      'API_KEY',
      'LOG_LEVEL',
    ]);
  });
});
