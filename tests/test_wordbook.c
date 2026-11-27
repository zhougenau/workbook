#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "wordbook_state.h"

static bool fits_bytes(const char *text, size_t bytes, void *context)
{
    (void)text;
    return bytes <= *(const size_t *)context;
}

static void test_pagination(void)
{
    size_t offsets[16];
    size_t limit = 5;
    const char *text = "one two three";
    size_t pages = wordbook_paginate(text, offsets, 16, fits_bytes, &limit);
    assert(pages == 3 && offsets[0] == 0 && offsets[1] == 4 && offsets[2] == 8);
    assert(offsets[pages] == strlen(text));
    text = "\xe4\xb8\xad\xe6\x96\x87 abc";
    pages = wordbook_paginate(text, offsets, 16, fits_bytes, &limit);
    assert(pages && offsets[pages] == strlen(text));
    for (size_t index = 0; index < pages; index++) {
        assert(offsets[index + 1] > offsets[index]);
        assert(offsets[index + 1] - offsets[index] <= limit);
        assert(((unsigned char)text[offsets[index]] & 0xC0) != 0x80);
    }
    assert(!wordbook_paginate(text, offsets, 2, fits_bytes, &limit));
    assert(wordbook_paginate("", offsets, 16, fits_bytes, &limit) == 1);
    limit = 0;
    assert(!wordbook_paginate("x", offsets, 16, fits_bytes, &limit));
    assert(!wordbook_paginate(NULL, offsets, 16, fits_bytes, &limit));
}

int main(void)
{
    test_pagination();
    uint16_t order[20], replay[20];
    for (int mode = WB_NEWEST; mode < WB_ORDER_COUNT; mode++) {
        wordbook_order_make(order, 20, mode, 123);
        for (size_t index = 0; index < 20; index++) {
            assert(order[index] < 20 && wordbook_order_find(order, 20, order[index]) == index);
            if (mode != WB_SHUFFLE) assert(order[index] == (mode == WB_NEWEST ? index : 19 - index));
        }
    }
    wordbook_order_make(replay, 20, WB_SHUFFLE, 123);
    assert(!memcmp(order, replay, sizeof(order)));
    wordbook_order_make(replay, 20, WB_SHUFFLE, 234);
    assert(memcmp(order, replay, sizeof(order)));
    assert(wordbook_idle_brightness(0) == 75);
    assert(wordbook_idle_brightness(59999999) == 75);
    assert(wordbook_idle_brightness(60000000) == 15);
    assert(wordbook_idle_brightness(INT64_MAX) == 15);
    wordbook_state_t state;
    wordbook_state_init(&state, 0, 100);
    assert(!wordbook_state_step(&state, WORDBOOK_NEXT));
    assert(!wordbook_state_step(&state, WORDBOOK_PAGE));
    wordbook_state_init(&state, 3, 100);
    assert(state.word == 2);
    assert(!wordbook_state_step(&state, WORDBOOK_NEXT));
    assert(wordbook_state_step(&state, WORDBOOK_PREVIOUS));
    assert(state.word == 1 && state.page == 0);
    wordbook_state_pages(&state, 3);
    assert(wordbook_state_step(&state, WORDBOOK_PAGE));
    assert(state.page == 1);
    assert(wordbook_state_step(&state, WORDBOOK_PAGE));
    assert(state.page == 2);
    assert(wordbook_state_step(&state, WORDBOOK_PAGE));
    assert(state.page == 0);
    assert(wordbook_state_step(&state, WORDBOOK_PAGE));
    assert(wordbook_state_step(&state, WORDBOOK_PREVIOUS));
    assert(state.word == 0 && state.page == 0 && state.pages == 1);
    assert(!wordbook_state_step(&state, WORDBOOK_PREVIOUS));
    wordbook_state_pages(&state, 0);
    assert(state.pages == 1);
    assert(!wordbook_state_step(&state, WORDBOOK_PAGE));
    assert(!wordbook_state_step(&state, (wordbook_action_t)999));
    wordbook_state_init(&state, 3, 1);
    assert(state.word == 1);
    puts("Wordbook state: PASS");
    return 0;
}