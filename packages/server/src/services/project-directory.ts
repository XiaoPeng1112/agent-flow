import { realpathSync } from 'fs'
import { isAbsolute, relative, resolve, sep } from 'path'

export function resolveProjectDirectory(projectPath: string, directory = '.'): string {
  const root = realpathSync(projectPath)
  const cwd = realpathSync(resolve(root, directory))
  const path = relative(root, cwd)
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error('Working directory is outside the project')
  }
  return cwd
}
