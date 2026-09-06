import express from 'express'
import { createServer } from 'http'
import { describe, expect, it, vi } from 'vitest'
import { createAgentsRouter } from '../src/routes/agents.js'

describe('agent execution route security', () => {
  it('executes only the script and working directory configured on the run node', async () => {
    const executeDET = vi.fn(() => 'turn-safe')
    const projectPath = process.cwd()
    const workflowEngine = {
      getRun: () => ({
        id: 'run-1',
        projectId: 'project-1',
        nodes: [{
          id: 'node-1',
          status: 'running',
          executionMode: 'det',
          script: 'yarn test',
        }],
      }),
    }
    const app = express()
    app.use(express.json())
    app.use('/api/agents', createAgentsRouter({
      agentService: { executeDET } as never,
      workflowEngine: workflowEngine as never,
      dynamicAgentFactory: {} as never,
      projectService: { getProject: () => ({ id: 'project-1', path: projectPath }) } as never,
    }))

    const server = createServer(app)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port')
    const endpoint = `http://127.0.0.1:${address.port}/api/agents/execute-det`

    try {
      const rejected = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: 'node-1',
          runId: 'run-1',
          script: 'touch /tmp/should-not-run',
          cwd: '/tmp',
          executionMode: 'det',
        }),
      })
      expect(rejected.status).toBe(400)
      expect(executeDET).not.toHaveBeenCalled()

      const accepted = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: 'node-1',
          runId: 'run-1',
          script: 'yarn test',
          cwd: projectPath,
          executionMode: 'det',
        }),
      })
      expect(accepted.status).toBe(200)
      expect(executeDET).toHaveBeenCalledWith({
        nodeId: 'node-1',
        runId: 'run-1',
        script: 'yarn test',
        cwd: projectPath,
      })
    } finally {
      await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
    }
  })
})
