import type { VocabularyEntry } from './types'

export const MASTERY_FILTER_OPTIONS = ['all', 'learning', '0', '1', '2', '3', '4', '5'] as const
export const VOCABULARY_SORT_OPTIONS = ['newest', 'oldest', 'az', 'mastery'] as const

export type MasteryFilter = typeof MASTERY_FILTER_OPTIONS[number]
export type VocabularySort = typeof VOCABULARY_SORT_OPTIONS[number]

export interface VocabularyListOptions {
  search?: string
  masteryFilter?: MasteryFilter
  sort?: VocabularySort
}

type SearchableVocabularyEntry = Pick<VocabularyEntry, 'term' | 'meaning' | 'note' | 'mastery' | 'createdAt'>

export function filterAndSortVocabularyEntries<T extends SearchableVocabularyEntry>(
  entries: readonly T[],
  options: VocabularyListOptions = {},
): T[] {
  const search = (options.search || '').trim().toLocaleLowerCase()
  const masteryFilter = options.masteryFilter || 'all'
  const sort = options.sort || 'newest'

  return entries
    .filter((entry) => {
      const matchesText = !search || [entry.term, entry.meaning, entry.note]
        .some((value) => value.toLocaleLowerCase().includes(search))
      const matchesMastery = masteryFilter === 'all'
        || (masteryFilter === 'learning'
          ? entry.mastery > 0 && entry.mastery < 5
          : entry.mastery === Number(masteryFilter))
      return matchesText && matchesMastery
    })
    .sort((left, right) => {
      if (sort === 'oldest') return left.createdAt.localeCompare(right.createdAt)
      if (sort === 'az') return left.term.localeCompare(right.term)
      if (sort === 'mastery') return left.mastery - right.mastery
      return right.createdAt.localeCompare(left.createdAt)
    })
}
