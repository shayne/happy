import { describe, it, expect } from 'vitest';
import { CodexPermissionHandler } from '@/codex/utils/permissionHandler';

class TestRpcHandlerManager {
    handler: ((response: any) => Promise<void> | void) | null = null;

    registerHandler<TRequest, TResponse>(method: string, handler: (req: TRequest) => TResponse): void {
        if (method !== 'permission') {
            throw new Error(`Unexpected method registered: ${method}`);
        }
        this.handler = handler as unknown as (response: any) => Promise<void> | void;
    }
}

class TestSession {
    rpcHandlerManager = new TestRpcHandlerManager();
    agentState: any = {};

    updateAgentState = (fn: (state: any) => any) => {
        this.agentState = fn(this.agentState);
    };
}

function withTimeout<T>(promise: Promise<T>, ms = 100): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
    ]);
}

describe('BasePermissionHandler id normalization', () => {
    it('resolves permission when response id is string but request id was number', async () => {
        const session = new TestSession();
        const handler = new CodexPermissionHandler(session as any);

        const pending = handler.handleToolCall(123 as any, 'CodexBash', { command: 'ls', cwd: '/' });

        expect(session.rpcHandlerManager.handler).toBeTruthy();
        await session.rpcHandlerManager.handler!({
            id: '123',
            approved: true,
            decision: 'approved'
        });

        const result = await withTimeout(pending, 100);
        expect(result.decision).toBe('approved');
    });

    it('returns execpolicy amendment decision with command', async () => {
        const session = new TestSession();
        const handler = new CodexPermissionHandler(session as any);

        const pending = handler.handleToolCall('exec-1', 'CodexBash', { command: ['yarn', 'dev'], cwd: '/' });

        expect(session.rpcHandlerManager.handler).toBeTruthy();
        await session.rpcHandlerManager.handler!({
            id: 'exec-1',
            approved: true,
            decision: 'approved_execpolicy_amendment',
            execPolicyAmendment: { command: ['yarn', 'dev'] }
        });

        const result = await withTimeout(pending, 100);
        expect(result.decision).toBe('approved_execpolicy_amendment');
        expect(result.execPolicyAmendment).toEqual({ command: ['yarn', 'dev'] });
    });
});

describe('CodexPermissionHandler auto-approve', () => {
    it('auto-approves in yolo mode without waiting for RPC', async () => {
        const session = new TestSession();
        const handler = new CodexPermissionHandler(session as any);
        handler.setPermissionMode('yolo');

        const result = await withTimeout(
            handler.handleToolCall('tool-1', 'CodexBash', { command: ['ls'], cwd: '/' }),
            100
        );

        expect(result.decision).toBe('approved_for_session');
        expect(session.agentState.completedRequests?.['tool-1']?.status).toBe('approved');
    });
});
