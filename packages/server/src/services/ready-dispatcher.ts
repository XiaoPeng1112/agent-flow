import type { Run, TaskNode } from '../types/index.js'

/** The persisted ready/running node states are the queue; this only serializes claims per run. */
export class ReadyDispatcher {
  private draining = new Map<string, Promise<void>>()
  private requested = new Set<string>()

  constructor(private deps: {
    getRun: (id: string) => Run | undefined
    startNode: (runId: string, nodeId: string) => Promise<unknown>
    execute: (run: Run, node: TaskNode) => Promise<void>
    fail: (runId: string, nodeId: string, error: Error) => Promise<void>
  }) {}

  request(runId: string): Promise<void> {
    this.requested.add(runId)
    const existing = this.draining.get(runId)
    if (existing) return existing
    // Defer until the map entry exists, including when a synchronous claim emits an event.
    const promise = Promise.resolve().then(async () => {
      do {
        this.requested.delete(runId)
        await this.drain(runId)
      } while (this.requested.has(runId))
    }).finally(() => this.draining.delete(runId))
    this.draining.set(runId, promise)
    return promise
  }

  private async drain(runId: string): Promise<void> {
    for (;;) {
      const run = this.deps.getRun(runId)
      if (!run || run.status !== 'running') return
      const enabled = run.config?.autoExecute ||
        (run.config?.autoFlow?.enabled && run.config.autoFlow.autoStart !== false)
      if (!enabled) return
      const limit = run.config?.maxParallel ?? 5
      if (run.nodes.filter(node => node.status === 'running').length >= limit) return
      const node = run.nodes.find(node => node.status === 'ready')
      if (!node) return
      let claimed = false
      try {
        await this.deps.startNode(runId, node.id)
        claimed = true
        await this.deps.execute(run, node)
      } catch (error) {
        // Claim failure must not fail a node another caller already owns.
        if (!claimed) return
        await this.deps.fail(runId, node.id, error instanceof Error ? error : new Error(String(error)))
      }
    }
  }
}
