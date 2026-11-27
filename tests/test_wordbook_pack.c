#include "wordbook_pack.h"
#include <assert.h>
#include <string.h>

int main(void)
{
    const char valid[] = "WBP1\1id\0term\0\xe4\xb8\xad\0note";
    const char duplicate[] = "WBP1\2id\0one\0m\0n\0id\0two\0m\0n";
    const char missing[] = "WBP1\1id\0term\0A\xf0\xa0\x80\x80" "B\0note";
    const char malformed[] = "WBP1\1id\0term\0\xe6\x97\0note";
    wordbook_pack_t pack = {0};
    assert(wordbook_pack_parse(valid, sizeof(valid), &pack));
    assert(pack.count == 1 && !strcmp(pack.entries[0].term, "term"));
    for (size_t length = 0; length < sizeof(valid); length++)
        assert(!wordbook_pack_parse(valid, length, &pack));
    assert(!wordbook_pack_parse(valid, 16385, &pack));
    assert(!wordbook_pack_parse(duplicate, sizeof(duplicate), &pack));
    assert(wordbook_pack_parse(missing, sizeof(missing), &pack));
    assert(!wordbook_pack_parse(malformed, sizeof(malformed), &pack));
    assert(!strcmp(pack.entries[0].meaning, "A\xf0\xa0\x80\x80" "B"));
    assert(pack.count == 1 && !strcmp(pack.entries[0].note, "note"));
    const char story[] = "WBP2\5a\0one\0m\0n\0b\0two\0m\0n\0c\0three\0m\0n\0d\0four\0m\0n\0e\0five\0m\0n\0English\0Translation\0Targets";
    assert(wordbook_pack_parse(story, sizeof(story), &pack));
    assert(!strcmp(pack.story[2], "Targets"));
    assert(!wordbook_pack_parse(story, sizeof(story) - 1, &pack));
}