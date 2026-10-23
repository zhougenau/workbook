import type { VocabularyEntry } from './types'

export type ReviewSchedule = {
  wordId: string
  dueAt: string
  intervalDays: number
  streak: number
  lastReviewedAt: string
  updatedAt: string
}

const intervals = [1, 3, 7, 14, 30]

export function scheduleReview(wordId: string, previous: ReviewSchedule | undefined, remembered: boolean, now: string): ReviewSchedule {
  const streak = remembered ? Math.min((previous?.streak ?? 0) + 1, intervals.length) : 0
  const intervalDays = remembered ? intervals[streak - 1] : 0
  const dueAt = new Date(Date.parse(now) + (remembered ? intervalDays * 86400000 : 10 * 60000)).toISOString()
  return { wordId, dueAt, intervalDays, streak, lastReviewedAt: now, updatedAt: now }
}

export function dueReviewWords<T extends VocabularyEntry>(words: T[], schedules: ReviewSchedule[], now: string): T[] {
  const byId = new Map(schedules.map((schedule) => [schedule.wordId, schedule]))
  return words.filter((word) => !word.deletedAt && Date.parse(byId.get(word.id)?.dueAt ?? word.createdAt) <= Date.parse(now))
    .sort((left, right) => {
      const leftDue = byId.get(left.id)?.dueAt ?? left.createdAt
      const rightDue = byId.get(right.id)?.dueAt ?? right.createdAt
      return Date.parse(leftDue) - Date.parse(rightDue) || left.id.localeCompare(right.id)
    })
}