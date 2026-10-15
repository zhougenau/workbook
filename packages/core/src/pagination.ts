export const DEFAULT_PAGE_SIZE = 10
export const PAGE_SIZE_OPTIONS = [10, 20, 50] as const

export interface PaginationResult<T> {
  items: T[]
  currentPage: number
  pageSize: number
  totalItems: number
  totalPages: number
  startIndex: number
  endIndex: number
  firstItemNumber: number
  lastItemNumber: number
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

export function paginate<T>(items: readonly T[], requestedPage: number, requestedPageSize: number): PaginationResult<T> {
  const pageSize = positiveInteger(requestedPageSize, DEFAULT_PAGE_SIZE)
  const totalItems = items.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const currentPage = Math.min(positiveInteger(requestedPage, 1), totalPages)
  const startIndex = (currentPage - 1) * pageSize
  const endIndex = Math.min(startIndex + pageSize, totalItems)

  return {
    items: items.slice(startIndex, endIndex),
    currentPage,
    pageSize,
    totalItems,
    totalPages,
    startIndex,
    endIndex,
    firstItemNumber: totalItems === 0 ? 0 : startIndex + 1,
    lastItemNumber: endIndex,
  }
}
