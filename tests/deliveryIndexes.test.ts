import { describe, expect, it } from 'bun:test'
import { NotificationDeliveriesCollection } from '../src/collections/NotificationDeliveries'

describe('notification-deliveries indexes', () => {
  it('declares compound indexes for dedupe and status scans', () => {
    expect(NotificationDeliveriesCollection().indexes).toEqual([
      { fields: ['dedupeKey', 'recipientKey', 'channel'] },
      { fields: ['status', 'updatedAt'] },
    ])
  })
})
