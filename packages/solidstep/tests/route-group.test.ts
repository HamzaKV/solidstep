import { describe, it, expect } from 'vitest';
import { parseGroupPath } from '../utils/route-group';

describe('parseGroupPath', () => {
    it('detects a group segment and strips it for the parent', () => {
        expect(parseGroupPath('/dashboard/@stats')).toEqual({
            group: '@stats',
            parent: '/dashboard',
        });
    });

    it('detects a root-level group', () => {
        expect(parseGroupPath('/@sidebar')).toEqual({
            group: '@sidebar',
            parent: '',
        });
    });

    it('returns null for a plain path', () => {
        expect(parseGroupPath('/dashboard/stats')).toBeNull();
    });

    it('does not treat a mid-segment @ as a group (e.g. /foo@bar is a page dir)', () => {
        // Only a segment that STARTS with @ is a parallel-route group —
        // matching typegen's per-segment rule. A literal @ inside a segment
        // must not silently demote the page to a group.
        expect(parseGroupPath('/foo@bar')).toBeNull();
        expect(parseGroupPath('/docs/v@2/page-path')).toBeNull();
    });
});
