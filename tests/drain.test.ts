import { describe, expect, it, mock } from 'bun:test'
import { drainNotificationQueue } from '../src/jobs/drain'

const payloadWith = (results: Array<Record<string, unknown>>) => {
  const run = mock(async () => results.shift() ?? { noJobsRemaining: true })
  return { payload: { jobs: { run }, config: {} } as never, run }
}

describe('drainNotificationQueue', () => {
  it('stops as soon as the queue is empty', async () => {
    const { payload, run } = payloadWith([{ noJobsRemaining: true }])
    expect(await drainNotificationQueue({ payload, queue: 'notifications' })).toEqual({
      passes: 1,
      drained: true,
      budgetExceeded: false,
    })
    expect(run).toHaveBeenCalledWith({ queue: 'notifications', limit: 10, overrideAccess: true })
  })

  it('makes further passes while jobs remain, up to maxPasses', async () => {
    const { payload, run } = payloadWith([
      { noJobsRemaining: false },
      { noJobsRemaining: false },
      { noJobsRemaining: false },
    ])
    const result = await drainNotificationQueue({ payload, queue: 'n', maxPasses: 2 })
    expect(result).toEqual({ passes: 2, drained: false, budgetExceeded: false })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('respects the time budget', async () => {
    const { payload, run } = payloadWith([])
    const result = await drainNotificationQueue({ payload, queue: 'n', budgetMs: 0 })
    expect(result.budgetExceeded).toBe(true)
    expect(run).not.toHaveBeenCalled()
  })

  it('defaults to the notifications queue', async () => {
    const { payload, run } = payloadWith([{ noJobsRemaining: true }])
    await drainNotificationQueue({ payload })
    expect((run.mock.calls[0] as unknown as [{ queue: string }])[0].queue).toBe('notifications')
  })
})
