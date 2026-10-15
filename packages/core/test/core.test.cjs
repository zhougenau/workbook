const test = require('node:test')
const assert = require('node:assert/strict')
const core = require('../dist/index.cjs')

const entry = (overrides = {}) => ({
  id: '00000000-0000-4000-8000-000000000001', term: 'Example', meaning: '示例', note: '', mastery: 2,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ownerId: 'owner',
  deletedAt: null, syncStatus: 'synced', ...overrides,
})

test('parses vocabulary text', () => {
  assert.deepEqual(core.analyzeVocabularyText('convivial adj.\n欢乐友好的\nThe dinner was convivial.'), {
    term: 'convivial', meaning: '欢乐友好的', example: 'The dinner was convivial.',
  })
})

test('calculates mastery evidence with Web thresholds', () => {
  const quiz = { questions: [
    { wordId: 'w', type: 'meaning', correctIndex: 0 },
    { wordId: 'w', type: 'usage', correctIndex: 1 },
  ] }
  const up = core.calculateMasteryChanges(quiz, { 0: 0, 1: 1 }, [entry({ id: 'w' })], 'basic')[0]
  const down = core.calculateMasteryChanges(quiz, { 0: 1, 1: 0 }, [entry({ id: 'w' })], 'basic')[0]
  assert.equal(up.evidence, 2.4)
  assert.equal(up.nextLevel, 3)
  assert.equal(down.evidence, -2.76)
  assert.equal(down.nextLevel, 1)
})

test('normalizes and validates entry boundaries', () => {
  const normalized = core.normalizeVocabularyEntry({ id: 'old', term: '  Word ', mastery: 99 }, () => 'new-id', () => '2026-01-01T00:00:00.000Z')
  assert.equal(normalized.id, 'new-id')
  assert.equal(normalized.term, 'Word')
  assert.equal(normalized.mastery, 5)
  assert.equal(core.validateSyncEntry(entry()), true)
  assert.equal(core.validateSyncEntry(entry({ term: 'x'.repeat(201) })), false)
})

test('merges by timestamp and tombstones duplicate normalized terms', () => {
  const older = entry({ id: 'a', term: ' Word ', updatedAt: '2026-01-01T00:00:00.000Z' })
  const newer = entry({ id: 'b', term: 'word', updatedAt: '2026-01-02T00:00:00.000Z' })
  const remote = entry({ id: 'a', term: ' Word ', meaning: 'remote', updatedAt: '2026-01-03T00:00:00.000Z' })
  const merged = core.mergeEntriesLastWriteWins([older, newer], [remote])
  assert.equal(merged.find((item) => item.id === 'a').meaning, 'remote')
  const reconciled = core.reconcileDuplicateTerms(merged, 'owner', '2026-01-04T00:00:00.000Z')
  assert.equal(reconciled.find((item) => item.id === 'b').deletedAt, '2026-01-04T00:00:00.000Z')
})

test('paginates and clamps deterministic boundaries', () => {
  const values = Array.from({ length: 23 }, (_, index) => index + 1)
  const middle = core.paginate(values, 2, 10)
  assert.deepEqual(middle.items, [11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
  assert.deepEqual(
    { currentPage: middle.currentPage, totalPages: middle.totalPages, first: middle.firstItemNumber, last: middle.lastItemNumber },
    { currentPage: 2, totalPages: 3, first: 11, last: 20 },
  )

  const clamped = core.paginate(values, 99, 10)
  assert.deepEqual(clamped.items, [21, 22, 23])
  assert.equal(clamped.currentPage, 3)

  const empty = core.paginate([], -1, 0)
  assert.deepEqual(
    { items: empty.items, currentPage: empty.currentPage, pageSize: empty.pageSize, totalPages: empty.totalPages, first: empty.firstItemNumber, last: empty.lastItemNumber },
    { items: [], currentPage: 1, pageSize: 10, totalPages: 1, first: 0, last: 0 },
  )
})

test('filters and sorts vocabulary without mutating source order', () => {
  const source = [
    entry({ id: 'b', term: 'Bravo', meaning: '目标', mastery: 2, createdAt: '2026-01-02T00:00:00.000Z' }),
    entry({ id: 'a', term: 'Alpha', mastery: 5, createdAt: '2026-01-03T00:00:00.000Z' }),
    entry({ id: 'c', term: 'Charlie', mastery: 0, createdAt: '2026-01-01T00:00:00.000Z' }),
  ]

  assert.deepEqual(core.filterAndSortVocabularyEntries(source).map((item) => item.id), ['a', 'b', 'c'])
  assert.deepEqual(core.filterAndSortVocabularyEntries(source, { search: '目标' }).map((item) => item.id), ['b'])
  assert.deepEqual(core.filterAndSortVocabularyEntries(source, { masteryFilter: 'learning' }).map((item) => item.id), ['b'])
  assert.deepEqual(core.filterAndSortVocabularyEntries(source, { masteryFilter: '5' }).map((item) => item.id), ['a'])
  assert.deepEqual(core.filterAndSortVocabularyEntries(source, { sort: 'oldest' }).map((item) => item.id), ['c', 'b', 'a'])
  assert.deepEqual(core.filterAndSortVocabularyEntries(source, { sort: 'az' }).map((item) => item.id), ['a', 'b', 'c'])
  assert.deepEqual(core.filterAndSortVocabularyEntries(source, { sort: 'mastery' }).map((item) => item.id), ['c', 'b', 'a'])
  assert.deepEqual(source.map((item) => item.id), ['b', 'a', 'c'])
  assert.deepEqual(core.MASTERY_FILTER_OPTIONS, ['all', 'learning', '0', '1', '2', '3', '4', '5'])
  assert.deepEqual(core.VOCABULARY_SORT_OPTIONS, ['newest', 'oldest', 'az', 'mastery'])
})

test('validates flashcards, selects words, and clamps navigation', () => {
  const result = core.parseGeneratedFlashcards({
    cards: [{
      wordId: 'a', word: 'Alpha', meaning: '阿尔法', usage: 'Alpha starts the sequence.',
      synonyms: ['first'], antonyms: ['last'], memoryTip: '联想第一个字母。',
    }],
    tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
  })
  assert.equal(result.cards[0].word, 'Alpha')
  assert.throws(() => core.parseGeneratedFlashcards({ cards: [], tokenUsage: {} }), /卡片内容不完整/)

  const words = ['a', 'b', 'c', 'd'].map((id) => ({ id }))
  assert.deepEqual(core.selectFlashcardWords(words, ['c']).map((word) => word.id), ['c'])
  const sampled = core.selectFlashcardWords(words, [], 2, () => 0)
  assert.equal(sampled.length, 2)
  assert.equal(new Set(sampled.map((word) => word.id)).size, 2)
  assert.deepEqual(words.map((word) => word.id), ['a', 'b', 'c', 'd'])
  assert.equal(core.clampFlashcardIndex(-1, 4), 0)
  assert.equal(core.clampFlashcardIndex(9, 4), 3)
  assert.equal(core.clampFlashcardIndex(2, 4), 2)
})