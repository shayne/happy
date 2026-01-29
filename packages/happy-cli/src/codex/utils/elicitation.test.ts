import { describe, it, expect } from 'vitest';
import {
    buildElicitationResponse,
    getElicitationResponseStyle,
    mapDecisionToAction,
    mapPermissionResultToDecision,
    parseCodexVersion
} from './elicitation';

describe('elicitation helpers', () => {
    it('builds decision-only elicitation responses', () => {
        const res = buildElicitationResponse('decision', 'accept', 'approved');
        expect(res).toEqual({ action: 'accept', decision: 'approved' });
    });

    it('builds action+decision+content elicitation responses', () => {
        const res = buildElicitationResponse('both', 'accept', 'approved');
        expect(res).toEqual({ action: 'accept', decision: 'approved', content: {} });
    });

    it('maps decisions to elicitation actions', () => {
        expect(mapDecisionToAction('approved')).toBe('accept');
        expect(mapDecisionToAction('approved_for_session')).toBe('accept');
        expect(mapDecisionToAction({ approved_execpolicy_amendment: { proposed_execpolicy_amendment: ['yarn'] } })).toBe('accept');
        expect(mapDecisionToAction('abort')).toBe('cancel');
        expect(mapDecisionToAction('denied')).toBe('decline');
    });

    it('maps permission result to execpolicy amendment decision', () => {
        const decision = mapPermissionResultToDecision({
            decision: 'approved_execpolicy_amendment',
            execPolicyAmendment: { command: ['yarn'] }
        });
        expect(decision).toEqual({
            approved_execpolicy_amendment: {
                proposed_execpolicy_amendment: ['yarn']
            }
        });
    });

    it('parses codex version strings', () => {
        const info = parseCodexVersion('codex-cli 0.77.0');
        expect(info.parsed).toBe(true);
        expect(info.major).toBe(0);
        expect(info.minor).toBe(77);
        expect(info.patch).toBe(0);
    });

    it('selects elicitation response style based on version', () => {
        const oldInfo = parseCodexVersion('codex-cli 0.77.0');
        const newInfo = parseCodexVersion('codex-cli 0.78.0');
        expect(getElicitationResponseStyle(oldInfo)).toBe('decision');
        expect(getElicitationResponseStyle(newInfo)).toBe('both');
    });
});
