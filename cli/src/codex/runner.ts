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
        return {
            command: 'npx',
            args: ['-y', spec],
            label: spec
        };
    }

    return {
        command: 'codex',
        args: [],
        label: 'codex'
    };
}

export function buildCodexMcpCommand(runner: CodexRunner): { command: string; args: string[] } {
    return {
        command: runner.command,
        args: [...runner.args, CODEX_MCP_SUBCOMMAND]
    };
}

export function consumeCodexPackageSpec(args: string[]): { spec: string | null; args: string[] } {
    if (args.length === 0) {
        return { spec: null, args };
    }

    const candidate = parseCodexPackageSpec(args[0]);
    if (!candidate) {
        return { spec: null, args };
    }

    return {
        spec: candidate,
        args: args.slice(1)
    };
}
