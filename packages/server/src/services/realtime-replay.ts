import { randomUUID } from 'crypto'

/** Bounded replay for one server lifetime; a new epoch or evicted range requires a state snapshot. */
export class RealtimeReplay {
  readonly epoch = randomUUID()
  private sequence = 0
  private bytes = 0
  private events: Array<{ sequence: number; raw: string; bytes: number }> = []
  constructor(private snapshot: () => unknown, private maxEvents = 2000, private maxBytes = 8 * 1024 * 1024) {}

  publish(message: { type: string; payload: unknown; timestamp: number }): string {
    const sequence = ++this.sequence
    const raw = JSON.stringify({ ...message, epoch: this.epoch, sequence })
    const bytes = Buffer.byteLength(raw)
    this.events.push({ sequence, raw, bytes })
    this.bytes += bytes
    while (this.events.length > this.maxEvents || this.bytes > this.maxBytes) this.bytes -= this.events.shift()!.bytes
    return raw
  }

  synchronize(request: { epoch?: unknown; after?: unknown }, send: (raw: string) => void): void {
    const after = request.after
    if (!Number.isSafeInteger(after) || (after as number) < 0) throw new Error('Invalid realtime cursor')
    const oldest = this.events[0]?.sequence ?? this.sequence + 1
    if (request.epoch !== this.epoch || (after as number) < oldest - 1 || (after as number) > this.sequence) {
      send(JSON.stringify({ type: 'sync:snapshot', epoch: this.epoch, sequence: this.sequence,
        timestamp: Date.now(), payload: this.snapshot() }))
    } else {
      for (const event of this.events) if (event.sequence > (after as number)) send(event.raw)
    }
    send(JSON.stringify({ type: 'sync:ready', epoch: this.epoch, sequence: this.sequence, timestamp: Date.now(), payload: {} }))
  }
}
