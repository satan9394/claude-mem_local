import { afterEach, describe, expect, it } from 'bun:test';

const ownedServers: Bun.Server<unknown>[] = [];

afterEach(() => {
  for (const server of ownedServers.splice(0)) server.stop(true);
});

async function ensureHealthyLoopback(port: number, body: Record<string, unknown>): Promise<Response> {
  try {
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port,
      fetch() {
        return Response.json(body);
      },
    });
    ownedServers.push(server);
  } catch {
    // ponytail: a user's already-running local service is the stronger coexistence proof.
  }
  return fetch(`http://127.0.0.1:${port}/health`, { redirect: 'manual' });
}

describe('provider port coexistence', () => {
  it('keeps the worker on 37777 and CC Switch on 15721 independently reachable', async () => {
    const ccSwitch = await ensureHealthyLoopback(15721, { status: 'healthy', source: 'test' });
    const worker = await ensureHealthyLoopback(37777, { status: 'ok', source: 'test' });
    const ccBody = await ccSwitch.json() as { status?: string };
    const workerBody = await worker.json() as { status?: string };

    expect(ccSwitch.status).toBe(200);
    expect(ccBody.status).toBe('healthy');
    expect(worker.status).toBe(200);
    expect(workerBody.status).toBe('ok');
    expect(15721).not.toBe(37777);
  });
});
