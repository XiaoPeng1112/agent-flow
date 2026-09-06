import { describe, expect, it } from 'vitest'
import { RealtimeReplay } from '../src/services/realtime-replay.js'
import { ReplayCursor } from '../../client/src/api/replay-cursor.js'

function fixture(maxEvents = 10, maxBytes?: number) {
  let state = ''
  const hub = new RealtimeReplay(() => ({ text: state }), maxEvents, maxBytes)
  const cursor = new ReplayCursor()
  let rendered = ''
  const receive = (raw: string) => {
    const message = JSON.parse(raw)
    return cursor.receive(message, () => {
      if (message.type === 'sync:snapshot') rendered = message.payload.text
      if (message.type === 'agent:turn_output') rendered += message.payload.chunk
    })
  }
  const sync = () => hub.synchronize(cursor.request().payload, receive)
  const publish = (text: string) => {
    state += text
    return hub.publish({ type: 'agent:turn_output', payload: { chunk: text }, timestamp: Date.now() })
  }
  return { hub, cursor, receive, sync, publish, rendered: () => rendered }
}

describe('Realtime reconnection', () => {
  it('loads a snapshot, replays missing chunks, and ignores duplicate delivery', () => {
    const f = fixture()
    f.publish('already running')
    f.sync()
    const live = f.publish(' live')
    f.receive(live)
    f.publish(' missed one')
    f.publish(' missed two')
    f.sync()
    f.receive(live)
    expect(f.rendered()).toBe('already running live missed one missed two')
  })
  it('recovers from a gap without applying an out-of-order chunk', () => {
    const f = fixture()
    f.sync()
    f.publish('one')
    const second = f.publish('two')
    expect(f.receive(second)).toBe(true)
    expect(f.rendered()).toBe('')
    f.sync()
    expect(f.rendered()).toBe('onetwo')
  })
  it('falls back to a complete snapshot when the replay window has been evicted', () => {
    const f = fixture(1)
    f.sync()
    f.publish('one')
    f.publish('two')
    f.sync()
    expect(f.rendered()).toBe('onetwo')
  })
  it('enforces the byte budget as well as the event count', () => {
    const f = fixture(100, 50)
    f.sync()
    f.publish('large event')
    f.sync()
    expect(f.rendered()).toBe('large event')
  })
  it('replaces state after a server restart even when sequence numbers happen to match', () => {
    const f = fixture()
    f.sync()
    f.receive(f.publish('old'))
    const restarted = new RealtimeReplay(() => ({ text: 'restored database state' }))
    restarted.synchronize(f.cursor.request().payload, f.receive)
    expect(f.rendered()).toBe('restored database state')
  })
  it('rejects invalid cursors and never advances when applying a message fails', () => {
    const f = fixture()
    expect(() => f.hub.synchronize({ after: -1 }, () => {})).toThrow()
    expect(() => f.hub.synchronize({ after: NaN }, () => {})).toThrow()
    f.sync()
    const event = JSON.parse(f.publish('once'))
    expect(() => f.cursor.receive(event, () => { throw new Error('render failed') })).toThrow('render failed')
    f.sync()
    expect(f.rendered()).toBe('once')
  })
})
