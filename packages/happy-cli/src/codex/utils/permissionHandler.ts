/**
 * Codex Permission Handler
 *
 * Handles tool permission requests and responses for Codex sessions.
 * Extends BasePermissionHandler with Codex-specific configuration.
 */

import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import type { PermissionMode } from '@/api/types';
import {
    BasePermissionHandler,
    PermissionResult,
    PendingRequest
} from '@/utils/BasePermissionHandler';

// Re-export types for backwards compatibility
export type { PermissionResult, PendingRequest };

/**
 * Codex-specific permission handler.
 */
export class CodexPermissionHandler extends BasePermissionHandler {
    private currentPermissionMode: PermissionMode = 'default';
    constructor(session: ApiSessionClient) {
        super(session);
    }

    protected getLogPrefix(): string {
        return '[Codex]';
    }

    /**
     * Set the current permission mode
     * This affects how tool calls are automatically approved/denied
     */
    setPermissionMode(mode: PermissionMode): void {
        if (this.currentPermissionMode === mode) {
            return;
        }
        this.currentPermissionMode = mode;
        logger.infoDeveloper(`${this.getLogPrefix()} Permission mode set to: ${mode}`);
    }

    /**
     * Check if a tool should be auto-approved based on permission mode
     */
    private shouldAutoApprove(toolName: string, toolCallId: string, _input: unknown): boolean {
        const alwaysAutoApproveNames = ['change_title', 'happy__change_title', 'GeminiReasoning', 'CodexReasoning', 'think', 'save_memory'];
        const alwaysAutoApproveIds = ['change_title', 'save_memory'];

        if (alwaysAutoApproveNames.some(name => toolName.toLowerCase().includes(name.toLowerCase()))) {
            return true;
        }
        if (alwaysAutoApproveIds.some(id => toolCallId.toLowerCase().includes(id.toLowerCase()))) {
            return true;
        }

        switch (this.currentPermissionMode) {
            case 'yolo':
                return true;
            case 'safe-yolo':
                return true;
            case 'read-only': {
                const writeTools = ['write', 'edit', 'create', 'delete', 'patch', 'fs-edit'];
                const isWriteTool = writeTools.some(wt => toolName.toLowerCase().includes(wt));
                return !isWriteTool;
            }
            case 'default':
            default:
                return false;
        }
    }

    /**
     * Handle a tool permission request
     * @param toolCallId - The unique ID of the tool call
     * @param toolName - The name of the tool being called
     * @param input - The input parameters for the tool
     * @returns Promise resolving to permission result
     */
    async handleToolCall(
        toolCallId: string,
        toolName: string,
        input: unknown
    ): Promise<PermissionResult> {
        const requestId = this.normalizeRequestId(toolCallId as unknown as string | number);
        if (this.shouldAutoApprove(toolName, requestId, input)) {
            const decision = this.currentPermissionMode === 'yolo' ? 'approved_for_session' : 'approved';
            logger.infoDeveloper(
                `${this.getLogPrefix()} Permission auto-approved: tool=${toolName} id=${requestId} mode=${this.currentPermissionMode} decision=${decision}`
            );

            this.session.updateAgentState((currentState) => ({
                ...currentState,
                completedRequests: {
                    ...currentState.completedRequests,
                    [requestId]: {
                        tool: toolName,
                        arguments: input,
                        createdAt: Date.now(),
                        completedAt: Date.now(),
                        status: 'approved',
                        decision
                    }
                }
            }));

            return {
                decision
            };
        }

        return new Promise<PermissionResult>((resolve, reject) => {
            // Store the pending request
            this.registerPendingRequest(requestId, {
                resolve,
                reject,
                toolName,
                input
            });

            // Update agent state with pending request
            this.addPendingRequestToState(requestId, toolName, input);

            logger.infoDeveloper(
                `${this.getLogPrefix()} Permission request pending: tool=${toolName} id=${requestId} mode=${this.currentPermissionMode}`
            );
            logger.debug(`${this.getLogPrefix()} Permission request sent for tool: ${toolName} (${requestId})`);
        });
    }
}
