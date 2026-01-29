/**
 * Base Permission Handler
 *
 * Abstract base class for permission handlers that manage tool approval requests.
 * Shared by Codex and Gemini permission handlers.
 *
 * @module BasePermissionHandler
 */

import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { AgentState } from "@/api/types";

/**
 * Permission response from the mobile app.
 */
export interface PermissionResponse {
    id: string | number;
    approved: boolean;
    decision?: 'approved' | 'approved_for_session' | 'approved_execpolicy_amendment' | 'denied' | 'abort';
    execPolicyAmendment?: { command: string[] };
}

/**
 * Pending permission request stored while awaiting user response.
 */
export interface PendingRequest {
    resolve: (value: PermissionResult) => void;
    reject: (error: Error) => void;
    toolName: string;
    input: unknown;
}

/**
 * Result of a permission request.
 */
export interface PermissionResult {
    decision: 'approved' | 'approved_for_session' | 'approved_execpolicy_amendment' | 'denied' | 'abort';
    execPolicyAmendment?: { command: string[] };
}

/**
 * Abstract base class for permission handlers.
 *
 * Subclasses must implement:
 * - `getLogPrefix()` - returns the log prefix (e.g., '[Codex]')
 */
export abstract class BasePermissionHandler {
    protected pendingRequests = new Map<string, PendingRequest>();
    protected session: ApiSessionClient;
    private isResetting = false;
    private pendingWarningTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private static readonly PENDING_WARNING_MS = 30_000;

    /**
     * Returns the log prefix for this handler.
     */
    protected abstract getLogPrefix(): string;

    /**
     * Normalize request IDs to strings to ensure consistent matching between
     * Map keys and JSON object keys (which are always strings).
     */
    protected normalizeRequestId(id: string | number): string {
        return typeof id === 'string' ? id : String(id);
    }

    /**
     * Register a pending request and start a delayed warning if it remains pending.
     */
    protected registerPendingRequest(requestId: string, pending: PendingRequest): void {
        this.pendingRequests.set(requestId, pending);
        this.schedulePendingWarning(requestId, pending.toolName);
    }

    constructor(session: ApiSessionClient) {
        this.session = session;
        this.setupRpcHandler();
    }

    /**
     * Update the session reference (used after offline reconnection swaps sessions).
     * This is critical for avoiding stale session references after onSessionSwap.
     */
    updateSession(newSession: ApiSessionClient): void {
        logger.debug(`${this.getLogPrefix()} Session reference updated`);
        this.session = newSession;
        // Re-setup RPC handler with new session
        this.setupRpcHandler();
    }

    /**
     * Setup RPC handler for permission responses.
     */
    protected setupRpcHandler(): void {
        this.session.rpcHandlerManager.registerHandler<PermissionResponse, void>(
            'permission',
            async (response) => {
                const requestId = this.normalizeRequestId(response.id);
                const pending = this.pendingRequests.get(requestId);
                if (!pending) {
                    logger.debug(`${this.getLogPrefix()} Permission request not found or already resolved`);
                    return;
                }

                // Remove from pending
                this.pendingRequests.delete(requestId);
                this.clearPendingWarning(requestId);

                // Resolve the permission request
                const result: PermissionResult = (() => {
                    if (response.approved) {
                        const wantsExecpolicyAmendment = response.decision === 'approved_execpolicy_amendment'
                            && Boolean(response.execPolicyAmendment?.command?.length);
                        if (wantsExecpolicyAmendment) {
                            return {
                                decision: 'approved_execpolicy_amendment',
                                execPolicyAmendment: response.execPolicyAmendment
                            };
                        }
                        return {
                            decision: response.decision === 'approved_for_session' ? 'approved_for_session' : 'approved'
                        };
                    }
                    return {
                        decision: response.decision === 'denied' ? 'denied' : 'abort'
                    };
                })();

                pending.resolve(result);

                // Move request to completed in agent state
                this.session.updateAgentState((currentState) => {
                    const request = currentState.requests?.[requestId];
                    if (!request) return currentState;

                    const { [requestId]: _, ...remainingRequests } = currentState.requests || {};

                    let res = {
                        ...currentState,
                        requests: remainingRequests,
                        completedRequests: {
                            ...currentState.completedRequests,
                            [requestId]: {
                                ...request,
                                completedAt: Date.now(),
                                status: response.approved ? 'approved' : 'denied',
                                decision: result.decision
                            }
                        }
                    } satisfies AgentState;
                    return res;
                });

                logger.infoDeveloper(
                    `${this.getLogPrefix()} Permission decision: tool=${pending.toolName} id=${requestId} decision=${result.decision}`
                );
                logger.debug(`${this.getLogPrefix()} Permission ${response.approved ? 'approved' : 'denied'} for ${pending.toolName}`);
            }
        );
    }

    /**
     * Add a pending request to the agent state.
     */
    protected addPendingRequestToState(toolCallId: string, toolName: string, input: unknown): void {
        const requestId = this.normalizeRequestId(toolCallId);
        this.session.updateAgentState((currentState) => ({
            ...currentState,
            requests: {
                ...currentState.requests,
                [requestId]: {
                    tool: toolName,
                    arguments: input,
                    createdAt: Date.now()
                }
            }
        }));
    }

    /**
     * Reset state for new sessions.
     * This method is idempotent - safe to call multiple times.
     */
    reset(): void {
        // Guard against re-entrant/concurrent resets
        if (this.isResetting) {
            logger.debug(`${this.getLogPrefix()} Reset already in progress, skipping`);
            return;
        }
        this.isResetting = true;

        try {
            // Snapshot pending requests to avoid Map mutation during iteration
            const pendingSnapshot = Array.from(this.pendingRequests.entries());
            this.pendingRequests.clear(); // Clear immediately to prevent new entries being processed

            // Reject all pending requests from snapshot
            for (const [id, pending] of pendingSnapshot) {
                this.clearPendingWarning(id);
                try {
                    pending.reject(new Error('Session reset'));
                } catch (err) {
                    logger.debug(`${this.getLogPrefix()} Error rejecting pending request ${id}:`, err);
                }
            }

            // Clear requests in agent state
            this.session.updateAgentState((currentState) => {
                const pendingRequests = currentState.requests || {};
                const completedRequests = { ...currentState.completedRequests };

                // Move all pending to completed as canceled
                for (const [id, request] of Object.entries(pendingRequests)) {
                    completedRequests[id] = {
                        ...request,
                        completedAt: Date.now(),
                        status: 'canceled',
                        reason: 'Session reset'
                    };
                }

                return {
                    ...currentState,
                    requests: {},
                    completedRequests
                };
            });

            logger.debug(`${this.getLogPrefix()} Permission handler reset`);
        } finally {
            this.isResetting = false;
        }
    }

    private schedulePendingWarning(requestId: string, toolName: string): void {
        if (this.pendingWarningTimers.has(requestId)) return;
        const timer = setTimeout(() => {
            if (this.pendingRequests.has(requestId)) {
                logger.infoDeveloper(
                    `${this.getLogPrefix()} Permission still pending after ${BasePermissionHandler.PENDING_WARNING_MS / 1000}s: tool=${toolName} id=${requestId}`
                );
            }
        }, BasePermissionHandler.PENDING_WARNING_MS);
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
        this.pendingWarningTimers.set(requestId, timer);
    }

    private clearPendingWarning(requestId: string): void {
        const timer = this.pendingWarningTimers.get(requestId);
        if (timer) {
            clearTimeout(timer);
        }
        this.pendingWarningTimers.delete(requestId);
    }
}
