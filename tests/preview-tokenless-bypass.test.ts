// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/preview/[projectId]/[[...path]]/route';

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(),
}));
vi.mock('@/lib/projects/project-repository', () => ({
  getProject: vi.fn(),
}));
vi.mock('@/lib/terminal-auth', () => ({
  createTerminalToken: vi.fn(() => ({ token: 'test-terminal-token', expiresAt: Date.now() + 60000 })),
}));
vi.mock('@/lib/terminal-config', () => ({
  requireTerminalBaseUrl: vi.fn(() => 'https://terminal.test'),
}));

import { auth } from '@/lib/auth';
import { getProject } from '@/lib/projects/project-repository';

const authMock = vi.mocked(auth);
const getProjectMock = vi.mocked(getProject);

function makeRequest(path: string, opts: RequestInit = {}) {
  return new NextRequest(`https://x.test${path}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...opts.headers,
    },
    ...opts,
  });
}

function makeParams(projectId: string, path?: string[]) {
  return { params: Promise.resolve({ projectId, path }) };
}

describe('session-less authorization bypass', () => {
  beforeEach(() => {
    vi.stubEnv('TERMINAL_AUTH_SECRET', 'x'.repeat(32));
    authMock.mockResolvedValue({ userId: null } as never);
    getProjectMock.mockResolvedValue({
      id: 'proj-1',
      userId: 'user-1',
      workspaceId: 'ws-1',
    } as never);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ content: '<h1>Hello</h1>', size: 13, encoding: 'utf-8' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('rejects a session-less request to the entry document with no token', async () => {
    const res = await GET(makeRequest('/api/preview/proj-1'), makeParams('proj-1'));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'Unauthorized' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects a session-less request to a token-mode asset path with no token', async () => {
    const res = await GET(
      makeRequest('/api/preview/proj-1/app.js'),
      makeParams('proj-1', ['app.js']),
    );
    expect(res.status).toBe(401);
  });

  it('session-less dot-segment path still cannot reach an asset without a valid token', async () => {
    const res = await GET(
      makeRequest('/api/preview/proj-1/./app.js'),
      makeParams('proj-1', ['.', 'app.js']),
    );
    // No session + no valid token prefix => token-mode branch never reached.
    expect(res.status).toBe(401);
  });

  it('session-authenticated owner still gets the entry document (session wins)', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' } as never);
    const res = await GET(makeRequest('/api/preview/proj-1'), makeParams('proj-1'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<h1>Hello</h1>');
    expect(global.fetch).toHaveBeenCalled();
  });

  it('session-authenticated owner cannot use a stale projected path as bypass', async () => {
    authMock.mockResolvedValue({ userId: 'user-1' } as never);
    const res = await GET(
      makeRequest('/api/preview/proj-1/app.js'),
      makeParams('proj-1', ['app.js']),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<h1>Hello</h1>');
  });
});
