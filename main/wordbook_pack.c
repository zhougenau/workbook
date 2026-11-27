#include "wordbook_pack.h"
#include <string.h>

static bool text_ok(const unsigned char *text, size_t size)
{
    for (size_t pos = 0; pos < size;) {
        unsigned lead = text[pos++];
        uint32_t code = lead;
        unsigned extra = 0;
        if (lead >= 128) {
            if (lead >= 194 && lead <= 223) { extra = 1; code &= 31; }
            else if (lead >= 224 && lead <= 239) { extra = 2; code &= 15; }
            else if (lead >= 240 && lead <= 244) { extra = 3; code &= 7; }
            else return false;
            if (extra > size - pos) return false;
            for (unsigned index = 0; index < extra; index++) {
                unsigned next = text[pos++];
                if ((next & 192) != 128) return false;
                code = (code << 6) | (next & 63);
            }
            if ((extra == 2 && code < 2048) || (extra == 3 && code < 65536) ||
                (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff) return false;
        }
        if (code == '\n') continue;
        if (code < 32 || (code >= 127 && code < 160)) return false;
    }
    return true;
}

bool wordbook_pack_parse(const char *data, size_t size, wordbook_pack_t *out)
{
    if (!data || !out || size < 6 || size > WORDBOOK_PACK_LIMIT) return false;
    bool story = !memcmp(data, "WBP2", 4);
    if (!story && memcmp(data, "WBP1", 4)) return false;
    wordbook_pack_t pack = {0};
    pack.count = (unsigned char)data[4];
    if (!pack.count || pack.count > WORDBOOK_PACK_WORDS) return false;
    size_t pos = 5;
    for (size_t index = 0; index < pack.count; index++) {
        const char *fields[4];
        size_t lengths[4];
        for (size_t field = 0; field < 4; field++) {
            fields[field] = data + pos;
            const char *end = memchr(fields[field], 0, size - pos);
            if (!end) return false;
            lengths[field] = (size_t)(end - fields[field]);
            pos += lengths[field] + 1;
        }
        if (!lengths[0] || lengths[0] > 64 || !lengths[1] || lengths[1] > 32 ||
            lengths[1] + lengths[2] + lengths[3] > 2048) return false;
        for (size_t ch = 0; ch < lengths[0]; ch++) {
            unsigned char value = fields[0][ch];
            if (value < 33 || value > 126) return false;
        }
        for (size_t ch = 0; ch < lengths[1]; ch++) {
            char value = fields[1][ch];
            if (!((value >= 'A' && value <= 'Z') || (value >= 'a' && value <= 'z') ||
                (ch && (value == ' ' || value == '-' || value == '\'')))) return false;
        }
        for (size_t field = 2; field < 4; field++)
            if (!text_ok((const unsigned char *)fields[field], lengths[field])) return false;
        for (size_t prior = 0; prior < index; prior++)
            if (!strcmp(pack.entries[prior].id, fields[0])) return false;
        pack.entries[index] = (wordbook_entry_t){ fields[0], fields[1], fields[2], fields[3] };
    }
    if (story) {
        if (pack.count < 5 || pack.count > 8) return false;
        for (size_t part = 0; part < 3; part++) {
            const char *start = data + pos;
            const char *end = memchr(start, 0, size - pos);
            if (!end || end == start || end - start > 2048 || !text_ok((const unsigned char *)start, end - start)) return false;
            pack.story[part] = start;
            pos += (size_t)(end - start) + 1;
        }
    }
    if (pos != size) return false;
    *out = pack;
    return true;
}