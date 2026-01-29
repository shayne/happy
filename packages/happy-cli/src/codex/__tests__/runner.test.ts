import { describe, expect, it } from 'vitest';
import {
    buildCodexMcpCommand,
    buildCodexRunner,
    CODEX_MCP_SUBCOMMAND,
    consumeCodexPackageSpec,
    parseCodexPackageSpec
} from '../runner';

describe('parseCodexPackageSpec', () => {
    it('accepts @openai/codex with an explicit version or tag', () => {
        expect(parseCodexPackageSpec('@openai/codex@latest')).toBe('@openai/codex@latest');
        expect(parseCodexPackageSpec('@openai/codex@0.92.0')).toBe('@openai/codex@0.92.0');
        expect(parseCodexPackageSpec('@openai/codex@beta')).toBe('@openai/codex@beta');
    });

    it('rejects non-codex inputs', () => {
        expect(parseCodexPackageSpec(undefined)).toBeNull();
        expect(parseCodexPackageSpec('codex')).toBeNull();
        expect(parseCodexPackageSpec('@openai/codex')).toBeNull();
        expect(parseCodexPackageSpec('@openai/other@latest')).toBeNull();
    });
});

describe('buildCodexRunner', () => {
    it('uses npx when a package spec is provided', () => {
        const runner = buildCodexRunner('@openai/codex@latest');
        expect(runner.command).toBe('npx');
        expect(runner.args).toEqual(['-y', '@openai/codex@latest']);
    });

    it('defaults to codex when no spec is provided', () => {
        const runner = buildCodexRunner(null);
        expect(runner.command).toBe('codex');
        expect(runner.args).toEqual([]);
    });
});

describe('buildCodexMcpCommand', () => {
    it('appends the MCP subcommand to the runner args', () => {
        const runner = buildCodexRunner('@openai/codex@latest');
        const command = buildCodexMcpCommand(runner);
        expect(command.command).toBe('npx');
        expect(command.args).toEqual(['-y', '@openai/codex@latest', CODEX_MCP_SUBCOMMAND]);
    });

    it('uses the default runner args for the MCP subcommand', () => {
        const runner = buildCodexRunner(null);
        const command = buildCodexMcpCommand(runner);
        expect(command.command).toBe('codex');
        expect(command.args).toEqual([CODEX_MCP_SUBCOMMAND]);
    });
});

describe('consumeCodexPackageSpec', () => {
    it('extracts the codex spec from args and returns the rest', () => {
        const result = consumeCodexPackageSpec(['@openai/codex@latest', '--started-by', 'terminal']);
        expect(result.spec).toBe('@openai/codex@latest');
        expect(result.args).toEqual(['--started-by', 'terminal']);
    });
});
