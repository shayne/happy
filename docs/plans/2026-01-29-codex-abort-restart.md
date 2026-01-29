# Codex Abort Restart Guard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restart the Codex session on the next prompt after an abort so Happy remains responsive even when the upstream Codex MCP server fails to resolve aborted tool calls.

**Architecture:** Add a small helper in `runCodex.ts` that resets session state and re-queues the next message. Set a `forceRestartOnNextMessage` flag in the abort handler and consume it in the main loop before processing the next user message. The existing resume-file logic will rehydrate context when possible.

**Tech Stack:** TypeScript, Vitest, Ink UI, Codex MCP client.

### Task 1: Add failing unit test for abort restart helper

**Files:**
- Create: `cli/src/codex/__tests__/abortRestart.test.ts`
- Modify: `cli/src/codex/runCodex.ts` (export helper name; not yet implemented in this task)

**Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { applyAbortRestart } from '../runCodex';

describe('applyAbortRestart', () => {
    it('resets session state and re-queues the message', () => {
        const message = {
            message: 'hello',
            mode: { permissionMode: 'default' },
            isolate: false,
            hash: 'mode-hash'
        } as any;

        const callbacks = {
            clearSession: vi.fn(),
            resetPermissions: vi.fn(),
            abortReasoning: vi.fn(),
            resetDiff: vi.fn(),
            keepAlive: vi.fn(),
            addStatus: vi.fn(),
        };

        const result = applyAbortRestart({
            message,
            state: { wasCreated: true, currentModeHash: 'old', thinking: true },
            callbacks,
        });

        expect(result.pending).toBe(message);
        expect(result.wasCreated).toBe(false);
        expect(result.currentModeHash).toBe(null);
        expect(result.thinking).toBe(false);
        expect(callbacks.clearSession).toHaveBeenCalledTimes(1);
        expect(callbacks.resetPermissions).toHaveBeenCalledTimes(1);
        expect(callbacks.abortReasoning).toHaveBeenCalledTimes(1);
        expect(callbacks.resetDiff).toHaveBeenCalledTimes(1);
        expect(callbacks.keepAlive).toHaveBeenCalledWith(false, 'remote');
        expect(callbacks.addStatus).toHaveBeenCalled();
    });
});
```

**Step 2: Run the test to verify it fails**

Run:
```bash
cd /Users/shayne/code/happy/.worktrees/fix-codex-abort-guard
mise exec -- yarn test -- cli/src/codex/__tests__/abortRestart.test.ts
```
Expected: FAIL because `applyAbortRestart` is not exported/implemented yet.

### Task 2: Implement abort restart helper + integration

**Files:**
- Modify: `cli/src/codex/runCodex.ts`
- Test: `cli/src/codex/__tests__/abortRestart.test.ts`

**Step 1: Add helper implementation**

```ts
type AbortRestartState = {
    wasCreated: boolean;
    currentModeHash: string | null;
    thinking: boolean;
};

type AbortRestartCallbacks = {
    clearSession: () => void;
    resetPermissions: () => void;
    abortReasoning: () => void;
    resetDiff: () => void;
    keepAlive: (thinking: boolean, source: 'remote') => void;
    addStatus: (message: string) => void;
};

export function applyAbortRestart({
    message,
    state,
    callbacks,
}: {
    message: { message: string; mode: any; isolate: boolean; hash: string };
    state: AbortRestartState;
    callbacks: AbortRestartCallbacks;
}): { pending: typeof message; wasCreated: boolean; currentModeHash: string | null; thinking: boolean } {
    callbacks.addStatus('═'.repeat(40));
    callbacks.addStatus('Starting new Codex session (after abort)...');
    callbacks.clearSession();
    callbacks.resetPermissions();
    callbacks.abortReasoning();
    callbacks.resetDiff();
    callbacks.keepAlive(false, 'remote');

    return {
        pending: message,
        wasCreated: false,
        currentModeHash: null,
        thinking: false,
    };
}
```

**Step 2: Wire the helper into the loop**

Add a `forceRestartOnNextMessage` flag near `abortController` and set it in `handleAbort()` when a session exists.

In the main loop, before the mode-change restart block, consume the flag:

```ts
if (forceRestartOnNextMessage && wasCreated) {
    forceRestartOnNextMessage = false;
    const restart = applyAbortRestart({
        message,
        state: { wasCreated, currentModeHash, thinking },
        callbacks: {
            clearSession: () => client.clearSession(),
            resetPermissions: () => permissionHandler.reset(),
            abortReasoning: () => reasoningProcessor.abort(),
            resetDiff: () => diffProcessor.reset(),
            keepAlive: (value, source) => session.keepAlive(value, source),
            addStatus: (text) => messageBuffer.addMessage(text, 'status'),
        },
    });
    wasCreated = restart.wasCreated;
    currentModeHash = restart.currentModeHash;
    thinking = restart.thinking;
    pending = restart.pending;
    continue;
}
if (forceRestartOnNextMessage) {
    forceRestartOnNextMessage = false;
}
```

**Step 3: Run the test to verify it passes**

Run:
```bash
cd /Users/shayne/code/happy/.worktrees/fix-codex-abort-guard
mise exec -- yarn test -- cli/src/codex/__tests__/abortRestart.test.ts
```
Expected: PASS.

**Step 4: Commit**

```bash
git add cli/src/codex/runCodex.ts cli/src/codex/__tests__/abortRestart.test.ts
git commit -m "fix: restart codex session after abort"
```
