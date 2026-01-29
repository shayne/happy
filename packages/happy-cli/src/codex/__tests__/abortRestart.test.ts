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
