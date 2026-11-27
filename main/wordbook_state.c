#include "wordbook_state.h"
#include <string.h>

void wordbook_order_make(uint16_t *indices, size_t count, wordbook_order_t mode, uint32_t seed)
{
    for (size_t index = 0; index < count; index++)
        indices[index] = (uint16_t)(mode == WB_OLDEST ? count - 1 - index : index);
    if (mode != WB_SHUFFLE) return;
    if (!seed) seed = 1;
    for (size_t remaining = count; remaining > 1; remaining--) {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        size_t pick = seed % remaining;
        uint16_t value = indices[pick];
        indices[pick] = indices[remaining - 1];
        indices[remaining - 1] = value;
    }
}

size_t wordbook_order_find(const uint16_t *indices, size_t count, size_t entry)
{
    for (size_t index = 0; index < count; index++)
        if (indices[index] == entry) return index;
    return 0;
}

int wordbook_idle_brightness(int64_t inactive_us)
{
    return inactive_us >= 60000000LL ? 15 : 75;
}

void wordbook_state_init(wordbook_state_t *state, size_t count, size_t restored)
{
    *state = (wordbook_state_t){ .count = count, .pages = 1 };
    if (count) state->word = restored < count ? restored : count - 1;
}

void wordbook_state_pages(wordbook_state_t *state, size_t pages)
{
    state->pages = pages ? pages : 1;
    if (state->page >= state->pages) state->page = 0;
}

bool wordbook_state_step(wordbook_state_t *state, wordbook_action_t action)
{
    if (!state->count) return false;
    if (action == WORDBOOK_PAGE) {
        if (state->pages == 1) return false;
        state->page = state->page + 1 == state->pages ? 0 : state->page + 1;
        return true;
    }
    if (action == WORDBOOK_PREVIOUS) {
        if (!state->word) return false;
        state->word--;
    } else if (action == WORDBOOK_NEXT) {
        if (state->word + 1 >= state->count) return false;
        state->word++;
    } else {
        return false;
    }
    state->page = 0;
    state->pages = 1;
    return true;
}

size_t wordbook_paginate(const char *text, size_t *offsets, size_t capacity,
                         wordbook_fits_t fits, void *context)
{
    if (!text || !offsets || capacity < 2 || !fits) return 0;
    const size_t length = strlen(text);
    size_t start = 0;
    size_t pages = 0;
    offsets[0] = 0;
    if (!length) {
        offsets[1] = 0;
        return 1;
    }
    while (start < length) {
        size_t cursor = start;
        size_t accepted = start;
        size_t last_break = start;
        while (cursor < length) {
            const size_t previous = cursor;
            cursor++;
            while (cursor < length && ((unsigned char)text[cursor] & 0xC0) == 0x80) cursor++;
            if (!fits(text + start, cursor - start, context)) break;
            accepted = cursor;
            const unsigned char character = (unsigned char)text[previous];
            if (character == ' ' || character == '\n' || character >= 0xE0) last_break = cursor;
        }
        if (accepted == start || pages + 1 >= capacity) return 0;
        if (accepted < length && last_break > start) accepted = last_break;
        offsets[++pages] = accepted;
        start = accepted;
    }
    return pages;
}