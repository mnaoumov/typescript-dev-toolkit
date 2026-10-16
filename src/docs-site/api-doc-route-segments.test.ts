import {
  describe,
  expect,
  it
} from 'vitest';

import {
  toRouteSegment,
  toRouteSegmentPreserveCase
} from './api-doc-route-segments.ts';

describe('api-doc route segments', () => {
  it('lowercases file segments', () => {
    expect(toRouteSegment('AbortSignalAny')).toBe('abortsignalany');
  });

  it('keeps case in route segments and collapses everything else to single dashes', () => {
    expect(toRouteSegmentPreserveCase('Abort SignalAny!')).toBe('Abort-SignalAny');
    expect(toRouteSegmentPreserveCase('**')).toBe('unnamed');
  });
});
