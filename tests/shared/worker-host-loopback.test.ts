import { describe, expect, it } from 'bun:test';
import { isLoopbackWorkerHost } from '../../src/shared/worker-utils';

describe('worker host binding', () => {
  it('accepts loopback only', () => {
    for (const host of ['127.0.0.1', '127.0.0.2', 'localhost', '::1', '[::1]']) {
      expect(isLoopbackWorkerHost(host)).toBe(true);
    }
    for (const host of ['0.0.0.0', '192.168.1.5', '10.0.0.1', 'example.com', '127.0.0.999']) {
      expect(isLoopbackWorkerHost(host)).toBe(false);
    }
  });
});
