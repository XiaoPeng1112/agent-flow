import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncService } from '../src/services/sync.js'

function createSyncService() {
  const authService = {
    getAccessToken: vi.fn(() => 'token'),
    isAuthenticated: vi.fn(() => true),
    getCurrentUser: vi.fn(() => ({ login: 'XiaoPeng1112' })),
  }

  const projectService = {
    getProjects: vi.fn(() => []),
  }

  const workflowEngine = {
    getRuns: vi.fn(() => []),
    getRun: vi.fn(),
    getRunTurns: vi.fn(() => ({})),
  }

  const templateService = {
    getTemplates: vi.fn(() => []),
  }

  return new SyncService(
    authService as any,
    projectService as any,
    workflowEngine as any,
    templateService as any,
  )
}

describe('SyncService', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('retries putFile once when GitHub returns 409 conflict', async () => {
    const service = createSyncService()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sha: 'sha-old' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: async () => ({ message: 'is at sha-new but expected sha-old' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sha: 'sha-new' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: { sha: 'sha-final' } }),
      })

    vi.stubGlobal('fetch', fetchMock)

    await (service as any).putFile('token', 'owner/repo', 'users/test/projects.json', '{"ok":true}')

    expect(fetchMock).toHaveBeenCalledTimes(4)

    const firstPutBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)
    const secondPutBody = JSON.parse(fetchMock.mock.calls[3]![1]!.body as string)

    expect(firstPutBody.sha).toBe('sha-old')
    expect(secondPutBody.sha).toBe('sha-new')
  })

  it('serializes concurrent push calls', async () => {
    const service = createSyncService()
    const order: string[] = []
    let releaseFirstPush: (() => void) | null = null

    ;(service as any).performPush = vi
      .fn()
      .mockImplementationOnce(async () => {
        order.push('start-1')
        await new Promise<void>((resolve) => {
          releaseFirstPush = resolve
        })
        order.push('end-1')
        return { success: true, filesUpdated: 1 }
      })
      .mockImplementationOnce(async () => {
        order.push('start-2')
        order.push('end-2')
        return { success: true, filesUpdated: 1 }
      })

    const push1 = service.push()
    const push2 = service.push()

    await Promise.resolve()
    expect((service as any).performPush).toHaveBeenCalledTimes(1)

    releaseFirstPush?.()
    await Promise.all([push1, push2])

    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2'])
  })

  it('keeps dirty state when new changes arrive during an ongoing push', async () => {
    const service = createSyncService()
    ;(service as any).config = { repoFullName: 'owner/repo', autoSync: true }
    ;(service as any).saveConfig = vi.fn().mockResolvedValue(undefined)
    ;(service as any).cleanupDeletedRuns = vi.fn().mockResolvedValue(undefined)
    ;(service as any).pushContextDb = vi.fn().mockResolvedValue(0)

    let firstPut = true
    ;(service as any).putFile = vi.fn().mockImplementation(async () => {
      if (firstPut) {
        firstPut = false
        service.markDirty()
      }
    })

    service.markDirty()
    await service.push()

    expect(service.getStatus().dirty).toBe(true)
  })
})
