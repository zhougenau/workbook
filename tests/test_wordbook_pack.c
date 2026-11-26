#include "wordbook_pack.h"
#include <assert.h>
#include <string.h>

static bool glyph(uint32_t code) { return code < 127 || code == 0x4e2d; }

int main(void)
{
    const char valid[] = "WBP1\1id\0term\0\xe4\xb8\xad\0note";
    const char duplicate[] = "WBP1\2id\0one\0m\0n\0id\0two\0m\0n";
    const char missing[] = "WBP1\1id\0term\0\xe6\x97\x85\0note";
    wordbook_pack_t pack = {0};
    assert(wordbook_pack_parse(valid, sizeof(valid), glyph, &pack));
    assert(pack.count == 1 && !strcmp(pack.entries[0].term, "term"));
    for (size_t length = 0; length < sizeof(valid); length++)
        assert(!wordbook_pack_parse(valid, length, glyph, &pack));
    assert(!wordbook_pack_parse(valid, 16385, glyph, &pack));
    assert(!wordbook_pack_parse(duplicate, sizeof(duplicate), glyph, &pack));
    assert(!wordbook_pack_parse(missing, sizeof(missing), glyph, &pack));
    assert(pack.count == 1 && !strcmp(pack.entries[0].note, "note"));
}