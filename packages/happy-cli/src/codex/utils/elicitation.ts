export type ElicitationAction = 'accept' | 'decline' | 'cancel';

export type ExecpolicyAmendmentDecision = {
    approved_execpolicy_amendment: {
        proposed_execpolicy_amendment: string[];
    };
};

export type ReviewDecision =
    | 'approved'
    | 'approved_for_session'
    | 'denied'
    | 'abort'
    | ExecpolicyAmendmentDecision;

export type ElicitationResponseStyle = 'decision' | 'both';

export type CodexVersionInfo = {
    raw: string | null;
    parsed: boolean;
    major: number;
    minor: number;
    patch: number;
    prereleaseTag?: string;
    prereleaseNum?: number;
};

type CodexVersionTarget = Pick<
    CodexVersionInfo,
    'major' | 'minor' | 'patch' | 'prereleaseTag' | 'prereleaseNum'
>;

const ELICITATION_DECISION_MAX_VERSION: CodexVersionTarget = {
    major: 0,
    minor: 77,
    patch: 0
};

export type PermissionDecision =
    | 'approved'
    | 'approved_for_session'
    | 'approved_execpolicy_amendment'
    | 'denied'
    | 'abort';

export type PermissionResult = {
    decision: PermissionDecision;
    execPolicyAmendment?: { command: string[] };
};

export function buildElicitationResponse(
    style: ElicitationResponseStyle,
    action: ElicitationAction,
    decision: ReviewDecision
): { action: ElicitationAction; decision?: ReviewDecision; content?: Record<string, unknown> } {
    if (style === 'decision') {
        return { action, decision };
    }
    return { action, decision, content: {} };
}

export function isExecpolicyAmendmentDecision(
    decision: ReviewDecision
): decision is ExecpolicyAmendmentDecision {
    return typeof decision === 'object'
        && decision !== null
        && 'approved_execpolicy_amendment' in decision;
}

export function mapDecisionToAction(decision: ReviewDecision): ElicitationAction {
    if (decision === 'approved' || decision === 'approved_for_session' || isExecpolicyAmendmentDecision(decision)) {
        return 'accept';
    }
    if (decision === 'abort') {
        return 'cancel';
    }
    return 'decline';
}

export function mapPermissionResultToDecision(result: PermissionResult): ReviewDecision {
    if (result.decision === 'approved_execpolicy_amendment') {
        if (result.execPolicyAmendment?.command?.length) {
            return {
                approved_execpolicy_amendment: {
                    proposed_execpolicy_amendment: result.execPolicyAmendment.command
                }
            };
        }
        return 'approved';
    }
    return result.decision;
}

export function parseCodexVersion(raw: string | null): CodexVersionInfo {
    if (!raw) {
        return { raw, parsed: false, major: 0, minor: 0, patch: 0 };
    }

    const match =
        raw.match(/(?:codex(?:-cli)?)\s+v?(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?/i)
        ?? raw.match(/\b(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?\b/);

    if (!match) {
        return { raw, parsed: false, major: 0, minor: 0, patch: 0 };
    }

    return {
        raw,
        parsed: true,
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prereleaseTag: match[4],
        prereleaseNum: match[5] ? Number(match[5]) : undefined
    };
}

function compareVersions(info: CodexVersionInfo, target: CodexVersionTarget): number {
    if (info.major !== target.major) return info.major - target.major;
    if (info.minor !== target.minor) return info.minor - target.minor;
    if (info.patch !== target.patch) return info.patch - target.patch;

    const infoTag = info.prereleaseTag;
    const targetTag = target.prereleaseTag;
    if (!infoTag && !targetTag) return 0;
    if (!infoTag && targetTag) return 1;
    if (infoTag && !targetTag) return -1;
    if (!infoTag || !targetTag) return 0;
    if (infoTag !== targetTag) return infoTag.localeCompare(targetTag);

    const infoNum = info.prereleaseNum ?? 0;
    const targetNum = target.prereleaseNum ?? 0;
    return infoNum - targetNum;
}

function isVersionAtMost(info: CodexVersionInfo, target: CodexVersionTarget): boolean {
    if (!info.parsed) return false;
    return compareVersions(info, target) <= 0;
}

export function getElicitationResponseStyle(info: CodexVersionInfo, override?: string): ElicitationResponseStyle {
    if (override === 'decision' || override === 'both') {
        return override;
    }

    if (!info.parsed) return 'both';
    return isVersionAtMost(info, ELICITATION_DECISION_MAX_VERSION) ? 'decision' : 'both';
}
