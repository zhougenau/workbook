export type Entry = { id: string; term: string; meaning: string; note: string }

export function encodePassportPack(entries: Entry[]): string {
  if (!entries.length || entries.length > 20) throw new Error('请选择 1 至 20 个单词')
  const encoder = new TextEncoder()
  const ids = new Set<string>()
  let body = 'WBP1' + String.fromCharCode(entries.length)
  for (const entry of entries) {
    const fields = [entry.id, entry.term.trim(), entry.meaning.trim(), entry.note.trim()].map(value => value.replace(/\r\n?/g, '\n').replace(/\t/g, ' '))
    if (!/^[!-~]{1,64}$/.test(fields[0]) || ids.has(fields[0]) || !/^[a-zA-Z][a-zA-Z '-]{0,31}$/.test(fields[1]) ||
        fields.some(value => /[\p{Cc}\p{Cs}]/u.test(value.replace(/\n/g, ''))) || encoder.encode(fields.slice(1).join('')).length > 2048) {
      throw new Error(`Passport 暂不支持此词条：${entry.term}`)
    }
    ids.add(fields[0])
    body += fields.join('\0') + '\0'
  }
  const bytes = encoder.encode(body)
  if (bytes.length > 16384) throw new Error('词单超过 16 KiB，请减少单词')
  return btoa(String.fromCharCode(...bytes))
}

export async function passportCodeHash(code: string) {
  const normalized = code.replace(/[ -]/g, '').toLowerCase()
  if (!/^[0-9a-f]{16}$/.test(normalized)) throw new Error('请输入设备屏上的 16 位领取码')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}