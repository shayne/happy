import { describe, expect, it } from 'vitest';
import { mapCodexPermissionModeToApprovalPolicy } from '../runCodex';

describe('mapCodexPermissionModeToApprovalPolicy', () => {
    it('maps yolo to on-failure (auto-approve in CLI)', () => {
        expect(mapCodexPermissionModeToApprovalPolicy('yolo')).toBe('on-failure');
    });

    it('keeps default as untrusted', () => {
        expect(mapCodexPermissionModeToApprovalPolicy('default')).toBe('untrusted');
    });
});
