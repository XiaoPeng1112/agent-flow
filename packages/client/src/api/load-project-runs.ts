import type { Run } from '../types'

/** Retry a discarded REST snapshot without treating it as an empty project. */
export async function loadProjectRuns(
  fetchRuns: () => Promise<{ runs: Run[] }>,
  getVersion: () => number,
  merge: (runs: Run[], version: number) => boolean,
  isDisposed: () => boolean,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const version = getVersion()
    const response = await fetchRuns()
    if (isDisposed() || merge(response.runs, version)) return
  }
  throw new Error('任务状态持续更新，请刷新后重试')
}
