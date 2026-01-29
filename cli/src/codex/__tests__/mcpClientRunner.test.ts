import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCodexRunner } from '../runner';
import { CodexMcpClient } from '../codexMcpClient';

const { execSyncMock, execFileSyncMock, transportMock } = vi.hoisted(() => ({
    execSyncMock: vi.fn(),
    execFileSyncMock: vi.fn(),
    transportMock: vi.fn()
}));

vi.mock('child_process', () => ({
    execSync: execSyncMock,
    execFileSync: execFileSyncMock
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
    StdioClientTransport: vi.fn((options) => {
        transportMock(options);
        return { options };
    })
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
    Client: class {
        setNotificationHandler() {}
        setRequestHandler() {}
        async connect() {}
    }
}));

afterEach(() => {
    execSyncMock.mockReset();
    execFileSyncMock.mockReset();
    transportMock.mockReset();
});

describe('CodexMcpClient runner', () => {
    it('uses the resolved runner for version detection and MCP transport', async () => {
        execSyncMock.mockReturnValue('codex-cli 0.92.0');
        execFileSyncMock.mockReturnValue('codex-cli 0.92.0');

        const runner = buildCodexRunner('@openai/codex@latest');
        const client = new CodexMcpClient(runner);

        await client.connect();

        expect(execFileSyncMock).toHaveBeenCalledWith(
            'npx',
            ['-y', '@openai/codex@latest', '--version'],
            { encoding: 'utf8' }
        );
        expect(transportMock).toHaveBeenCalledWith(
            expect.objectContaining({
                command: 'npx',
                args: ['-y', '@openai/codex@latest', 'mcp-server']
            })
        );
    });
});
