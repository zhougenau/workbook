function extractChineseMeaning(value: string) {
  const normalized = value.replace(/\(([\u3400-\u9fff，、；：。！？／\s]+)\)/gu, '（$1）')
  return normalized.match(/[\u3400-\u9fff（），、；：。！？／]+/gu)?.join('') ?? ''
}

function isLikelyEnglishExample(value: string) {
  const words = value.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? []
  return words.length >= 3 && /[.!?][”’"']?$/.test(value.trim())
}

export function analyzeVocabularyText(source: string) {
  const text = source.trim()
  if (!text) return null

  const marker = /(?:\*{0,2}(?:e\.?\s*g\.?|example|例句)\*{0,2})\s*[:：.]?\s*/i
  const markerMatch = marker.exec(text)
  const allLines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const inferredExampleIndex = markerMatch ? -1 : allLines.findIndex((line, index) => index > 0 && isLikelyEnglishExample(line))
  const beforeExample = markerMatch
    ? text.slice(0, markerMatch.index).trim()
    : inferredExampleIndex >= 0 ? allLines.slice(0, inferredExampleIndex).join('\n') : text
  const example = markerMatch
    ? text.slice(markerMatch.index + markerMatch[0].length).trim()
    : inferredExampleIndex >= 0 ? allLines[inferredExampleIndex] : ''
  const lines = beforeExample.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const heading = lines[0] ?? ''
  const termMatch = heading.match(/^([A-Za-z][A-Za-z'’-]*(?:[ -][A-Za-z][A-Za-z'’-]*)*)\s*(?=(?:adj|adv|noun|verb|prep|pron|conj|interj|n|v)\b|$)/i)
  const term = (termMatch?.[1] ?? heading.match(/[A-Za-z][A-Za-z'’-]*/)?.[0] ?? '').trim()
  const headingRemainder = heading
    .slice(termMatch?.[0].length ?? term.length)
    .replace(/^(?:adj|adv|noun|verb|prep|pron|conj|interj|n|v)\.?\s*/i, '')
    .trim()
  const meaning = extractChineseMeaning([headingRemainder, ...lines.slice(1)]
    .join(' ')
    .replace(/^\/[^/\r\n]+\/\s*/, '')
    .replace(/^(?:adj|adv|noun|verb|prep|pron|conj|interj|n|v)\.?\s*/i, '')
    .trim())

  return { term, meaning, example }
}