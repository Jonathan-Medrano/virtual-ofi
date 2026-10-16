export type SessionStatus = 'working' | 'waiting' | 'idle' | 'closed'

export interface SessionSnapshot {
  id: string
  pc: string
  account: string
  project: string
  status: SessionStatus
  updatedAt: number
}

export interface PutBody {
  pc: string
  sessions: SessionSnapshot[]
}

export const STATUSES: readonly SessionStatus[] = ['working', 'waiting', 'idle', 'closed']
