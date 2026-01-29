import { describe, expect, it } from 'vitest';
import { mapCodexPermissionModeToApprovalPolicy } from '../runCodex';

describe('mapCodexPermissionModeToApprovalPolicy', () => {
    it('maps yolo to never (no approvals)', () => {
        expect(mapCodexPermissionModeToApprovalPolicy('yolo')).toBe('never');
    });

    it('keeps default as untrusted', () => {
        expect(mapCodexPermissionModeToApprovalPolicy('default')).toBe('untrusted');
    });
});
