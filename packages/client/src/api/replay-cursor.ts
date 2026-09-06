/** Keep one cursor for the lifetime of a managed connection. Never persist a cursor without its UI state. */
export class ReplayCursor {
  private epoch?: string
  private sequence = 0
  private pending = false
  request() { this.pending = true; return { type: 'sync:request', payload: { epoch: this.epoch, after: this.sequence } } }
  receive(message: { type: string; epoch?: string; sequence?: number; payload?: unknown }, apply: () => void): boolean {
    if (message.type === 'sync:snapshot') {
      if (typeof message.epoch !== 'string' || !Number.isSafeInteger(message.sequence) || message.sequence! < 0) throw new Error('Invalid state snapshot')
      apply()
      this.epoch = message.epoch
      this.sequence = message.sequence!
      return false
    }
    if (message.type === 'sync:ready') {
      this.pending = false
      return message.epoch !== this.epoch || message.sequence !== this.sequence
    }
    if (message.sequence === undefined) { apply(); return false }
    if (message.epoch !== this.epoch || !Number.isSafeInteger(message.sequence) || message.sequence > this.sequence + 1) {
      return !this.pending
    }
    if (message.sequence <= this.sequence) return false
    apply()
    this.sequence = message.sequence
    return false
  }
}
