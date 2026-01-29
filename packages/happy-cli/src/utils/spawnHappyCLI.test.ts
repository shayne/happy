import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const testRoot = '/tmp/happy-cli-test';

vi.mock('@/projectPath', () => ({
    projectPath: () => testRoot
}));

vi.mock('child_process', () => ({
    spawn: vi.fn(() => ({ pid: 123 }))
}));

import { spawn } from 'child_process';
import { spawnHappyCLI } from './spawnHappyCLI';

beforeEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
    mkdirSync(join(testRoot, 'dist'), { recursive: true });
    writeFileSync(join(testRoot, 'dist', 'index.mjs'), '');
});

afterEach(() => {
    delete process.env.HAPPY_NODE_BIN;
    vi.clearAllMocks();
});

describe('spawnHappyCLI runtime selection', () => {
    it('uses HAPPY_NODE_BIN and omits node flags for bun runtime', () => {
        process.env.HAPPY_NODE_BIN = '/opt/bun';

        spawnHappyCLI(['--help']);

        expect(spawn).toHaveBeenCalledWith(
            '/opt/bun',
            [join(testRoot, 'dist', 'index.mjs'), '--help'],
            {}
        );
    });

    it('uses process.execPath and includes node flags by default', () => {
        spawnHappyCLI(['--version']);

        expect(spawn).toHaveBeenCalledWith(
            process.execPath,
            ['--no-warnings', '--no-deprecation', join(testRoot, 'dist', 'index.mjs'), '--version'],
            {}
        );
    });
});
