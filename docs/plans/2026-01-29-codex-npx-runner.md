# Codex Npx Runner Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow `happy @openai/codex@<version>` (and `happy codex @openai/codex@<version>`) to run Codex via `npx -y` while keeping PATH-based Codex as the default, and always use `mcp-server`.

**Architecture:** Add a Codex “runner” helper that resolves to either `codex` (PATH) or `npx -y <spec>`, and wire it into CLI argument parsing, `runCodex`, and `CodexMcpClient`. Remove legacy `mcp` selection and always use `mcp-server`.

**Tech Stack:** TypeScript, Vitest, Node child_process.

### Task 1: Add runner helper tests (TDD)

**Files:**
- Create: `cli/src/codex/__tests__/runner.test.ts`
- Create: `cli/src/codex/runner.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  buildCodexMcpCommand,
  buildCodexRunner,
  CODEX_MCP_SUBCOMMAND,
  parseCodexPackageSpec,
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
```

**Step 2: Run test to verify it fails**

Run: `yarn test -- src/codex/__tests__/runner.test.ts`
Expected: FAIL with “Cannot find module '../runner'”.

**Step 3: Write minimal implementation**

```ts
export type CodexRunner = {
  command: string;
  args: string[];
  label: string;
};

export const CODEX_MCP_SUBCOMMAND = 'mcp-server';

export function parseCodexPackageSpec(value?: string | null): string | null {
  if (!value) return null;
  return /^@openai\/codex@.+$/.test(value) ? value : null;
}

export function buildCodexRunner(spec?: string | null): CodexRunner {
  if (spec) {
    return { command: 'npx', args: ['-y', spec], label: spec };
  }
  return { command: 'codex', args: [], label: 'codex' };
}

export function buildCodexMcpCommand(runner: CodexRunner): { command: string; args: string[] } {
  return { command: runner.command, args: [...runner.args, CODEX_MCP_SUBCOMMAND] };
}
```

**Step 4: Run test to verify it passes**

Run: `yarn test -- src/codex/__tests__/runner.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add cli/src/codex/__tests__/runner.test.ts cli/src/codex/runner.ts
git commit -m "test: add codex runner helpers"
```

### Task 2: Wire runner into Codex MCP client

**Files:**
- Modify: `cli/src/codex/codexMcpClient.ts`

**Step 1: Write a failing test**

Add a minimal test to assert the MCP command uses `mcp-server` (via helper) and that the runner uses `npx` when spec is present by reusing the helper tests (no new test needed if coverage already exists).

**Step 2: Run test to verify it fails**

Run: `yarn test -- src/codex/__tests__/runner.test.ts`
Expected: still FAIL until client wiring is done (if new assertions added).

**Step 3: Write minimal implementation**

- Update constructor to accept a `CodexRunner`.
- Replace `execSync('codex --version')` with `execFileSync(runner.command, [...runner.args, '--version'])`.
- Remove legacy mcp selection; always use `buildCodexMcpCommand(runner)`.
- If `runner.command === 'codex'` and version call fails, keep the existing “Codex CLI not found” error.
- If using npx and it fails, throw a message that npm/spec failed.

**Step 4: Run tests**

Run: `yarn test -- src/codex/__tests__/runner.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add cli/src/codex/codexMcpClient.ts
git commit -m "feat: run codex via resolved runner"
```

### Task 3: Parse codex package spec in CLI + runCodex

**Files:**
- Modify: `cli/src/index.ts`
- Modify: `cli/src/codex/runCodex.ts`
- Modify: `cli/src/codex/codexMcpClient.ts` (constructor call)

**Step 1: Write a failing test**

Add a small helper in `cli/src/codex/runner.ts` (or a new file) to parse CLI args for a codex package spec, and test it in `runner.test.ts`:

```ts
import { consumeCodexPackageSpec } from '../runner';

it('extracts codex spec from args and returns the rest', () => {
  const result = consumeCodexPackageSpec(['@openai/codex@latest', '--started-by', 'terminal']);
  expect(result.spec).toBe('@openai/codex@latest');
  expect(result.args).toEqual(['--started-by', 'terminal']);
});
```

**Step 2: Run test to verify it fails**

Run: `yarn test -- src/codex/__tests__/runner.test.ts`
Expected: FAIL with missing export.

**Step 3: Write minimal implementation**

- Add `consumeCodexPackageSpec(args)` to `runner.ts`.
- In `cli/src/index.ts`, use it for the `codex` subcommand branch and the default codex branch.
- In `cli/src/codex/runCodex.ts`, accept `codexPackageSpec?: string | null` and create the runner.
- Construct `new CodexMcpClient(runner)`.

**Step 4: Run tests**

Run: `yarn test -- src/codex/__tests__/runner.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add cli/src/codex/runner.ts cli/src/index.ts cli/src/codex/runCodex.ts cli/src/codex/codexMcpClient.ts cli/src/codex/__tests__/runner.test.ts
git commit -m "feat: support codex npx package specs"
```

### Task 4: Update CLI help/README

**Files:**
- Modify: `cli/src/index.ts`
- Modify (optional): `README.md`

**Step 1: Add help text**

Add a short line to the Codex help showing `happy @openai/codex@latest`.

**Step 2: Commit**

```bash
git add cli/src/index.ts README.md
git commit -m "docs: mention codex npx usage"
```
