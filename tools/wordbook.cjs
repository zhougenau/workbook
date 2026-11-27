const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const local = path.join(root, 'build/wordbook');
const fontPath = path.join(root, 'assets/fonts/wordbook_font_16.c');

function prepare(entries) {
    assert(Array.isArray(entries), 'The backup must be a JSON array');
    const words = [];
    const excluded = [];
    const ids = new Set();
    const terms = new Set();
    const byAdded = entries.map(entry => ({ entry, added: Date.parse(entry?.createdAt) }));
    byAdded.sort((left, right) => (Number.isFinite(right.added) ? right.added : -Infinity)
        - (Number.isFinite(left.added) ? left.added : -Infinity));
    for (const { entry } of byAdded) {
        assert(entry && typeof entry === 'object', 'Invalid entry');
        if (entry.deletedAt != null) continue;
        for (const field of ['id', 'term', 'meaning', 'note']) {
            assert(typeof entry[field] === 'string', `Invalid ${field}`);
            assert(!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/u.test(entry[field]), `Control character in ${field}`);
            assert(!/[\uD800-\uDFFF]/u.test(entry[field]), `Invalid Unicode in ${field}`);
        }
        assert(entry.id.length > 0 && Buffer.byteLength(entry.id) <= 64, 'Invalid ID');
        assert(!ids.has(entry.id), 'Duplicate ID');
        ids.add(entry.id);
        const term = entry.term.trim();
        assert(term && term.length <= 32 && /^[A-Za-z][A-Za-z' -]*$/.test(term), 'Invalid term');
        const key = term.toLowerCase();
        assert(!terms.has(key), 'Duplicate term');
        terms.add(key);
        if (term === 'd' && !entry.meaning.trim()) {
            excluded.push({ term, reason: 'Incomplete entry; review original backup' });
            continue;
        }
        const word = {
            id: entry.id,
            term,
            meaning: entry.meaning.trim().replace(/（\s*）|\(\s*\)/gu, ''),
            note: entry.note.replace(/\r\n?/g, '\n').trim(),
        };
        assert(Buffer.byteLength(word.term + word.meaning + word.note) <= 2048, 'Entry exceeds supported text budget');
        words.push(word);
    }
    assert(words.length && words.length <= 10000, 'Unsupported word count');
    const rows = words.map(word => `    {${['id', 'term', 'meaning', 'note'].map(field => JSON.stringify(word[field])).join(', ')}},`);
    const source = '#include "wordbook_data.h"\n\nconst wordbook_entry_t wordbook_entries[] = {\n'
        + rows.join('\n') + '\n};\nconst size_t wordbook_count = sizeof(wordbook_entries) / sizeof(wordbook_entries[0]);\n';
    return { words, excluded, source };
}

function inventory() {
    const source = fs.existsSync(path.join(local, 'wordbook_data.c'))
        ? fs.readFileSync(path.join(local, 'wordbook_data.c'), 'utf8')
        : fs.readFileSync(path.join(root, 'assets/wordbook/sample.c'), 'utf8');
    const characters = new Set(Array.from({ length: 95 }, (_, index) => String.fromCodePoint(32 + index)));
    const decoder = new TextDecoder('gb18030', { fatal: true });
    const common = new Set();
    for (let row = 0xb0; row <= 0xf7; row++) {
        const last = row === 0xd7 ? 0xf9 : 0xfe;
        for (let cell = 0xa1; cell <= last; cell++) common.add(decoder.decode(Uint8Array.of(row, cell)));
    }
    assert.equal(common.size, 6763, 'Invalid GB2312 Han inventory');
    for (const character of common) characters.add(character);
    for (const character of '，。；：？！、（）《》【】“”‘’—…·□') characters.add(character);
    const strings = fs.readFileSync(path.join(root, 'main/wordbook_strings.h'), 'utf8');
    const sample = fs.readFileSync(path.join(root, 'assets/wordbook/sample.c'), 'utf8');
    for (const content of [source, strings, sample]) {
        for (const match of content.matchAll(/"(?:\\.|[^"\\])*"/gu)) {
            for (const character of JSON.parse(match[0])) {
                if (character.codePointAt(0) >= 32) characters.add(character);
            }
        }
    }
    return [...characters].sort((first, second) => first.codePointAt(0) - second.codePointAt(0));
}

function coveredCodepoints(source) {
    const lists = new Map();
    for (const match of source.matchAll(/static const uint(?:8|16)_t (\w+)\[\]\s*=\s*\{([\s\S]*?)\};/g)) {
        const body = match[2].replace(/\/\*[\s\S]*?\*\//g, '');
        lists.set(match[1], (body.match(/0x[\da-f]+|\d+/gi) || []).map(Number));
    }
    const block = source.match(/cmaps\[\]\s*=\s*\{([\s\S]*?)\n\};/);
    assert(block, 'Font cmaps not found');
    const points = new Set();
    for (const map of block[1].matchAll(/\{([^{}]+)\}/g)) {
        const value = field => {
            const match = map[1].match(new RegExp(`\\.${field}\\s*=\\s*(0x[\\da-f]+|\\d+)`, 'i'));
            assert(match, `Missing cmap ${field}`);
            return Number(match[1]);
        };
        const start = value('range_start');
        const list = map[1].match(/\.unicode_list\s*=\s*(\w+)/)[1];
        const type = map[1].match(/\.type\s*=\s*(\w+)/)[1];
        if (type === 'LV_FONT_FMT_TXT_CMAP_FORMAT0_FULL') {
            const offsets = lists.get(map[1].match(/\.glyph_id_ofs_list\s*=\s*(\w+)/)[1]);
            assert.equal(offsets?.length, value('range_length'));
            offsets.forEach((glyphOffset, index) => {
                if (index === 0 || glyphOffset !== 0) points.add(start + index);
            });
        } else if (list === 'NULL') {
            assert(type === 'LV_FONT_FMT_TXT_CMAP_FORMAT0_TINY');
            for (let offset = 0; offset < value('range_length'); offset++) points.add(start + offset);
        } else {
            assert(['LV_FONT_FMT_TXT_CMAP_SPARSE_TINY', 'LV_FONT_FMT_TXT_CMAP_SPARSE_FULL'].includes(type));
            assert(lists.has(list), `Missing Unicode list ${list}`);
            for (const offset of lists.get(list)) points.add(start + offset);
        }
    }
    assert(points.has(32) && !points.has(0x10ffff), 'Invalid font coverage controls');
    return points;
}

function checkFont() {
    const points = coveredCodepoints(fs.readFileSync(fontPath, 'utf8'));
    const missing = inventory().filter(character => !points.has(character.codePointAt(0)));
    assert.equal(missing.length, 0, 'Missing glyphs: ' + missing.map(character => 'U+' + character.codePointAt(0).toString(16)).join(' '));
    console.log(`Wordbook font: PASS (${inventory().length} required codepoints)`);
}

function main(args) {
    if (args[0] === 'prepare') {
        assert(args.length === 2, 'Usage: node tools/wordbook.cjs prepare <backup.json>');
        const bytes = fs.readFileSync(args[1]);
        const result = prepare(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
        fs.mkdirSync(local, { recursive: true });
        fs.writeFileSync(path.join(local, 'wordbook_data.c'), result.source);
        fs.writeFileSync(path.join(local, 'audit.json'), JSON.stringify({
            sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
            count: result.words.length,
            excluded: result.excluded,
            missingMeaning: result.words.filter(word => !word.meaning).map(word => word.term),
            missingNote: result.words.filter(word => !word.note).map(word => word.term),
        }, null, 2) + '\n');
        console.log(`Prepared ${result.words.length} words; excluded ${result.excluded.length}; private output in build/wordbook`);
    } else if (args[0] === 'font') {
        assert(args.length === 3, 'Usage: node tools/wordbook.cjs font <SourceHanSansSC-Regular.otf> <lv_font_conv.js>');
        const source = path.resolve(args[1]);
        const converter = path.resolve(args[2]);
        assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(converter), 'package.json'), 'utf8')).version, '1.5.3');
        assert.equal(crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),
            'f1d8611151880c6c336aabeac4640ef434fa13cbfbf1ffe82d0a71b2a5637256');
        const license = path.join(path.dirname(source), 'LICENSE.txt');
        assert(fs.readFileSync(license, 'utf8').includes('SIL OPEN FONT LICENSE Version 1.1'));
        fs.mkdirSync(path.dirname(fontPath), { recursive: true });
        const result = spawnSync(process.execPath, [converter, '--font', source, '--symbols',
            inventory().join(''),
            '--size', '16', '--bpp', '4', '--format', 'lvgl', '--no-compress',
            '--lv-font-name', 'wordbook_font_16', '--lv-include', 'lvgl.h', '--output', fontPath], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr || String(result.error));
        fs.writeFileSync(fontPath, fs.readFileSync(fontPath, 'utf8').replace(/^ \* Opts:.*$/m,
            ' * Generated by tools/wordbook.cjs; lv_font_conv 1.5.3; Source Han Sans SC Regular.'));
        fs.copyFileSync(license, path.join(path.dirname(fontPath), 'LICENSE.txt'));
        checkFont();
    } else {
        assert(args.length === 1 && args[0] === 'check', 'Commands: prepare, font, check');
        checkFont();
    }
}

module.exports = { prepare, coveredCodepoints };
if (require.main === module) main(process.argv.slice(2));