/**
 * Codex MCP Client - Simple wrapper for Codex tools
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { logger } from '@/ui/logger';
import type { CodexSessionConfig, CodexToolResponse } from './types';
import { z } from 'zod';
import { ElicitRequestParamsSchema, RequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { CodexPermissionHandler } from './utils/permissionHandler';
import { execSync } from 'child_process';
import { randomUUID } from 'node:crypto';
import {
    buildElicitationResponse,
    getElicitationResponseStyle,
    mapDecisionToAction,
    mapPermissionResultToDecision,
    parseCodexVersion,
    type CodexVersionInfo,
    type ElicitationResponseStyle,
    type ReviewDecision
} from './utils/elicitation';

const DEFAULT_TIMEOUT = 14 * 24 * 60 * 60 * 1000; // 14 days, which is the half of the maximum possible timeout (~28 days for int32 value in NodeJS)

function withPassthrough(schema: z.ZodTypeAny): z.ZodTypeAny {
    const maybePassthrough = (schema as { passthrough?: () => z.ZodTypeAny }).passthrough;
    if (typeof maybePassthrough === 'function') {
        return maybePassthrough.call(schema);
    }
    const maybeUnion = (schema as { _def?: { options?: z.ZodTypeAny[] } })._def?.options;
    if (Array.isArray(maybeUnion)) {
        const options = maybeUnion.map((option) => withPassthrough(option));
        if (options.length >= 2) {
            return z.union(options as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
        }
        return options[0] ?? schema;
    }
    return schema;
}

const ElicitRequestSchemaWithExtras = RequestSchema.extend({
    method: z.literal('elicitation/create'),
    params: withPassthrough(ElicitRequestParamsSchema)
});

// Codex MCP elicitation request params
interface CodexElicitationBase {
    message: string;
    codex_elicitation: 'exec-approval' | 'patch-approval';
    codex_mcp_tool_call_id: string;
    codex_event_id: string;
    codex_call_id: string;
}

interface ExecApprovalParams extends CodexElicitationBase {
    codex_elicitation: 'exec-approval';
    codex_command: string[];
    codex_cwd: string;
    codex_parsed_cmd?: Array<{ cmd: string; args?: string[] }>;
    codex_reason?: string;
}

interface PatchApprovalParams extends CodexElicitationBase {
    codex_elicitation: 'patch-approval';
    codex_reason?: string;
    codex_grant_root?: string;
    codex_changes?: unknown;
}

type CodexElicitationParams = ExecApprovalParams | PatchApprovalParams;

let cachedCodexVersionInfo: CodexVersionInfo | null = null;

function getCodexVersionInfo(): CodexVersionInfo {
    if (cachedCodexVersionInfo) return cachedCodexVersionInfo;

    try {
        const raw = execSync('codex --version', { encoding: 'utf8' }).trim();
        cachedCodexVersionInfo = parseCodexVersion(raw);
        return cachedCodexVersionInfo;
    } catch (error) {
        logger.debug('[CodexMCP] Error detecting codex version:', error);
        cachedCodexVersionInfo = parseCodexVersion(null);
        return cachedCodexVersionInfo;
    }
}

/**
 * Get the correct MCP subcommand based on installed codex version
 * Versions >= 0.43.0-alpha.5 use 'mcp-server', older versions use 'mcp'
 * Returns null if codex is not installed or version cannot be determined
 */
function getCodexMcpCommand(): string | null {
    try {
        const version = execSync('codex --version', { encoding: 'utf8' }).trim();
        const match = version.match(/codex-cli\s+(\d+\.\d+\.\d+(?:-alpha\.\d+)?)/);
        if (!match) {
            logger.debug('[CodexMCP] Could not parse codex version:', version);
            return null;
        }

        const versionStr = match[1];
        const [major, minor, patch] = versionStr.split(/[-.]/).map(Number);

        // Version >= 0.43.0-alpha.5 has mcp-server
        if (major > 0 || minor > 43) return 'mcp-server';
        if (minor === 43 && patch === 0) {
            // Check for alpha version
            if (versionStr.includes('-alpha.')) {
                const alphaNum = parseInt(versionStr.split('-alpha.')[1]);
                return alphaNum >= 5 ? 'mcp-server' : 'mcp';
            }
            return 'mcp-server'; // 0.43.0 stable has mcp-server
        }
        return 'mcp'; // Older versions use mcp
    } catch (error) {
        logger.debug('[CodexMCP] Codex CLI not found or not executable:', error);
        return null;
    }
}

export class CodexMcpClient {
    private client: Client;
    private transport: StdioClientTransport | null = null;
    private connected: boolean = false;
    private sessionId: string | null = null;
    private conversationId: string | null = null;
    private handler: ((event: any) => void) | null = null;
    private permissionHandler: CodexPermissionHandler | null = null;
    private execPolicyAmendments = new Map<string, string[]>();

    constructor() {
        this.client = new Client(
            { name: 'happy-codex-client', version: '1.0.0' },
            { capabilities: { elicitation: {} } }
        );

        this.client.setNotificationHandler(z.object({
            method: z.literal('codex/event'),
            params: z.object({
                msg: z.any()
            })
        }).passthrough(), (data) => {
            const msg = data.params.msg;
            this.updateIdentifiersFromEvent(msg);
            this.cacheExecPolicyAmendment(msg);
            this.handler?.(msg);
        });
    }

    setHandler(handler: ((event: any) => void) | null): void {
        this.handler = handler;
    }

    /**
     * Set the permission handler for tool approval
     */
    setPermissionHandler(handler: CodexPermissionHandler): void {
        this.permissionHandler = handler;
    }

    async connect(): Promise<void> {
        if (this.connected) return;

        const mcpCommand = getCodexMcpCommand();

        if (mcpCommand === null) {
            throw new Error(
                'Codex CLI not found or not executable.\n' +
                '\n' +
                'To install codex:\n' +
                '  npm install -g @openai/codex\n' +
                '\n' +
                'Alternatively, use Claude:\n' +
                '  happy claude'
            );
        }

        logger.debug(`[CodexMCP] Connecting to Codex MCP server using command: codex ${mcpCommand}`);

        this.transport = new StdioClientTransport({
            command: 'codex',
            args: [mcpCommand],
            env: Object.keys(process.env).reduce((acc, key) => {
                const value = process.env[key];
                if (typeof value === 'string') acc[key] = value;
                return acc;
            }, {} as Record<string, string>)
        });

        // Register request handlers for Codex permission methods
        this.registerPermissionHandlers();

        await this.client.connect(this.transport);
        this.connected = true;

        logger.debug('[CodexMCP] Connected to Codex');
    }

    private registerPermissionHandlers(): void {
        const versionInfo = getCodexVersionInfo();
        const responseStyle: ElicitationResponseStyle = getElicitationResponseStyle(
            versionInfo,
            process.env.HAPPY_CODEX_ELICITATION_STYLE?.toLowerCase()
        );

        // Register handler for exec command approval requests
        this.client.setRequestHandler(
            ElicitRequestSchemaWithExtras,
            async (request, extra) => {
                console.log('[CodexMCP] Received elicitation request:', request.params);

                // Load params
                const params = request.params as unknown as CodexElicitationParams;
                const permissionId = String(
                    params.codex_call_id ??
                    params.codex_mcp_tool_call_id ??
                    params.codex_event_id ??
                    extra?.requestId ??
                    randomUUID()
                );
                const isPatchApproval = params.codex_elicitation === 'patch-approval';
                const toolName = isPatchApproval ? 'CodexPatch' : 'CodexBash';
                const cachedAmendment = this.consumeExecPolicyAmendment(params.codex_call_id, params.codex_event_id);
                const input = isPatchApproval
                    ? this.buildPatchToolInput(params as PatchApprovalParams, params.message)
                    : this.buildExecToolInput(params as ExecApprovalParams, cachedAmendment);

                // If no permission handler set, deny by default
                if (!this.permissionHandler) {
                    logger.debug('[CodexMCP] No permission handler set, denying by default');
                    return buildElicitationResponse(responseStyle, 'decline', 'denied');
                }

                try {
                    // Request permission through the handler
                    const result = await this.permissionHandler.handleToolCall(
                        permissionId,
                        toolName,
                        input
                    );

                    logger.debug('[CodexMCP] Permission result:', result);
                    const decision: ReviewDecision = mapPermissionResultToDecision(result);
                    const action = mapDecisionToAction(decision);
                    return buildElicitationResponse(responseStyle, action, decision);
                } catch (error) {
                    logger.debug('[CodexMCP] Error handling permission request:', error);
                    return buildElicitationResponse(responseStyle, 'decline', 'denied');
                }
            }
        );

        logger.debug('[CodexMCP] Permission handlers registered');
    }

    private cacheExecPolicyAmendment(event: any): void {
        if (!event || typeof event !== 'object') return;
        if (event.type !== 'exec_approval_request') return;

        const callId = typeof event.call_id === 'string' ? event.call_id : undefined;
        const proposed = Array.isArray(event.proposed_execpolicy_amendment)
            ? event.proposed_execpolicy_amendment.filter((part: unknown): part is string => typeof part === 'string' && part.length > 0)
            : [];
        if (callId && proposed.length) {
            this.execPolicyAmendments.set(callId, proposed);
        }
    }

    private consumeExecPolicyAmendment(callId?: string, eventId?: string): string[] | undefined {
        let cached: string[] | undefined;
        if (callId) {
            cached = this.execPolicyAmendments.get(callId);
        }
        if (!cached && eventId) {
            cached = this.execPolicyAmendments.get(eventId);
        }
        if (callId) this.execPolicyAmendments.delete(callId);
        if (eventId) this.execPolicyAmendments.delete(eventId);
        return cached;
    }

    private extractString(params: object, key: string): string | undefined {
        const value = (params as Record<string, unknown>)[key];
        return typeof value === 'string' && value.length > 0 ? value : undefined;
    }

    private buildExecToolInput(
        params: ExecApprovalParams,
        cachedAmendment?: string[]
    ): {
        command: string[];
        cwd?: string;
        parsed_cmd?: unknown[];
        reason?: string;
        proposedExecpolicyAmendment?: string[];
    } {
        const command = Array.isArray(params.codex_command)
            ? params.codex_command.filter((p): p is string => typeof p === 'string')
            : [];
        const cwd = this.extractString(params, 'codex_cwd');
        const parsed_cmd = Array.isArray(params.codex_parsed_cmd)
            ? params.codex_parsed_cmd
            : undefined;
        const reason = this.extractString(params, 'codex_reason');
        const proposedExecpolicyAmendment = cachedAmendment;

        return { command, cwd, parsed_cmd, reason, proposedExecpolicyAmendment };
    }

    private buildPatchToolInput(
        params: PatchApprovalParams,
        message: string
    ): {
        message: string;
        reason?: string;
        grantRoot?: string;
        changes?: unknown;
    } {
        const reason = this.extractString(params, 'codex_reason');
        const grantRoot = this.extractString(params, 'codex_grant_root');
        const changes = typeof params.codex_changes === 'object'
            && params.codex_changes !== null
            ? params.codex_changes
            : undefined;

        return { message, reason, grantRoot, changes };
    }

    async startSession(config: CodexSessionConfig, options?: { signal?: AbortSignal }): Promise<CodexToolResponse> {
        if (!this.connected) await this.connect();

        logger.debug('[CodexMCP] Starting Codex session:', config);

        const response = await this.client.callTool({
            name: 'codex',
            arguments: config as any
        }, undefined, {
            signal: options?.signal,
            timeout: DEFAULT_TIMEOUT,
            // maxTotalTimeout: 10000000000 
        });

        logger.debug('[CodexMCP] startSession response:', response);

        // Extract session / conversation identifiers from response if present
        this.extractIdentifiers(response);

        return response as CodexToolResponse;
    }

    async continueSession(prompt: string, options?: { signal?: AbortSignal }): Promise<CodexToolResponse> {
        if (!this.connected) await this.connect();

        if (!this.sessionId) {
            throw new Error('No active session. Call startSession first.');
        }

        if (!this.conversationId) {
            // Some Codex deployments reuse the session ID as the conversation identifier
            this.conversationId = this.sessionId;
            logger.debug('[CodexMCP] conversationId missing, defaulting to sessionId:', this.conversationId);
        }

        const args = { sessionId: this.sessionId, conversationId: this.conversationId, prompt };
        logger.debug('[CodexMCP] Continuing Codex session:', args);

        const response = await this.client.callTool({
            name: 'codex-reply',
            arguments: args
        }, undefined, {
            signal: options?.signal,
            timeout: DEFAULT_TIMEOUT
        });

        logger.debug('[CodexMCP] continueSession response:', response);
        this.extractIdentifiers(response);

        return response as CodexToolResponse;
    }


    private updateIdentifiersFromEvent(event: any): void {
        if (!event || typeof event !== 'object') {
            return;
        }

        const candidates: any[] = [event];
        if (event.data && typeof event.data === 'object') {
            candidates.push(event.data);
        }

        for (const candidate of candidates) {
            const sessionId = candidate.session_id ?? candidate.sessionId;
            if (sessionId) {
                this.sessionId = sessionId;
                logger.debug('[CodexMCP] Session ID extracted from event:', this.sessionId);
            }

            const conversationId = candidate.conversation_id ?? candidate.conversationId;
            if (conversationId) {
                this.conversationId = conversationId;
                logger.debug('[CodexMCP] Conversation ID extracted from event:', this.conversationId);
            }
        }
    }
    private extractIdentifiers(response: any): void {
        const meta = response?.meta || {};
        if (meta.sessionId) {
            this.sessionId = meta.sessionId;
            logger.debug('[CodexMCP] Session ID extracted:', this.sessionId);
        } else if (response?.sessionId) {
            this.sessionId = response.sessionId;
            logger.debug('[CodexMCP] Session ID extracted:', this.sessionId);
        }

        if (meta.conversationId) {
            this.conversationId = meta.conversationId;
            logger.debug('[CodexMCP] Conversation ID extracted:', this.conversationId);
        } else if (response?.conversationId) {
            this.conversationId = response.conversationId;
            logger.debug('[CodexMCP] Conversation ID extracted:', this.conversationId);
        }

        const content = response?.content;
        if (Array.isArray(content)) {
            for (const item of content) {
                if (!this.sessionId && item?.sessionId) {
                    this.sessionId = item.sessionId;
                    logger.debug('[CodexMCP] Session ID extracted from content:', this.sessionId);
                }
                if (!this.conversationId && item && typeof item === 'object' && 'conversationId' in item && item.conversationId) {
                    this.conversationId = item.conversationId;
                    logger.debug('[CodexMCP] Conversation ID extracted from content:', this.conversationId);
                }
            }
        }
    }

    getSessionId(): string | null {
        return this.sessionId;
    }

    hasActiveSession(): boolean {
        return this.sessionId !== null;
    }

    clearSession(): void {
        // Store the previous session ID before clearing for potential resume
        const previousSessionId = this.sessionId;
        this.sessionId = null;
        this.conversationId = null;
        logger.debug('[CodexMCP] Session cleared, previous sessionId:', previousSessionId);
    }

    /**
     * Store the current session ID without clearing it, useful for abort handling
     */
    storeSessionForResume(): string | null {
        logger.debug('[CodexMCP] Storing session for potential resume:', this.sessionId);
        return this.sessionId;
    }

    /**
     * Force close the Codex MCP transport and clear all session identifiers.
     * Use this for permanent shutdown (e.g. kill/exit). Prefer `disconnect()` for
     * transient connection resets where you may want to keep the session id.
     */
    async forceCloseSession(): Promise<void> {
        logger.debug('[CodexMCP] Force closing session');
        try {
            await this.disconnect();
        } finally {
            this.clearSession();
        }
        logger.debug('[CodexMCP] Session force-closed');
    }

    async disconnect(): Promise<void> {
        if (!this.connected) return;

        // Capture pid in case we need to force-kill
        const pid = this.transport?.pid ?? null;
        logger.debug(`[CodexMCP] Disconnecting; child pid=${pid ?? 'none'}`);

        try {
            // Ask client to close the transport
            logger.debug('[CodexMCP] client.close begin');
            await this.client.close();
            logger.debug('[CodexMCP] client.close done');
        } catch (e) {
            logger.debug('[CodexMCP] Error closing client, attempting transport close directly', e);
            try { 
                logger.debug('[CodexMCP] transport.close begin');
                await this.transport?.close?.(); 
                logger.debug('[CodexMCP] transport.close done');
            } catch {}
        }

        // As a last resort, if child still exists, send SIGKILL
        if (pid) {
            try {
                process.kill(pid, 0); // check if alive
                logger.debug('[CodexMCP] Child still alive, sending SIGKILL');
                try { process.kill(pid, 'SIGKILL'); } catch {}
            } catch { /* not running */ }
        }

        this.transport = null;
        this.connected = false;
        // Preserve session/conversation identifiers for potential reconnection / recovery flows.
        logger.debug(`[CodexMCP] Disconnected; session ${this.sessionId ?? 'none'} preserved`);
    }
}
