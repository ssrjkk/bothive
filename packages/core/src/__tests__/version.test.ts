import { describe, it, expect, afterEach } from 'vitest';
import { resolveServiceVersion } from '../utils/version.js';

describe('resolveServiceVersion', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('prefers SERVICE_VERSION, which the release images bake in', () => {
    process.env.SERVICE_VERSION = 'v1.4.0';
    process.env.npm_package_version = '1.4.0';
    expect(resolveServiceVersion()).toBe('v1.4.0');
  });

  it('falls back to npm_package_version for `npm run`/`npm start`', () => {
    delete process.env.SERVICE_VERSION;
    process.env.npm_package_version = '1.4.0';
    expect(resolveServiceVersion()).toBe('1.4.0');
  });

  it('reports dev when neither is set', () => {
    // The production images run `node` directly with npm removed, so
    // npm_package_version is absent there; without SERVICE_VERSION the service
    // has no version to report.
    delete process.env.SERVICE_VERSION;
    delete process.env.npm_package_version;
    expect(resolveServiceVersion()).toBe('dev');
  });

  it('ignores blank values instead of reporting an empty version', () => {
    process.env.SERVICE_VERSION = '   ';
    process.env.npm_package_version = '1.4.0';
    expect(resolveServiceVersion()).toBe('1.4.0');
  });
});
