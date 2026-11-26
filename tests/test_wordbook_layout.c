#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "lvgl.h"
#include "wordbook_data.h"
#include "wordbook_state.h"
#include "wordbook_strings.h"

LV_FONT_DECLARE(wordbook_font_16);
static char s_candidate[2176];

static bool fits(const char *text, size_t bytes, void *context)
{
    (void)context;
    assert(bytes < sizeof(s_candidate));
    memcpy(s_candidate, text, bytes);
    s_candidate[bytes] = '\0';
    lv_point_t size;
    lv_text_get_size(&size, s_candidate, &wordbook_font_16, 0, 4, 204, LV_TEXT_FLAG_NONE);
    return size.y <= 152;
}

static void check_glyphs(const char *text)
{
    uint32_t offset = 0;
    while (text[offset]) {
        uint32_t codepoint;
        const unsigned char first = (unsigned char)text[offset++];
        if (first < 0x80) codepoint = first;
        else {
            unsigned remaining = first < 0xE0 ? 1 : first < 0xF0 ? 2 : 3;
            codepoint = first & (0x7F >> (remaining + 1));
            while (remaining--) codepoint = (codepoint << 6) | ((unsigned char)text[offset++] & 0x3F);
        }
        if (codepoint < 32) continue;
        lv_font_glyph_dsc_t glyph = {0};
        if (!lv_font_get_glyph_dsc(&wordbook_font_16, &glyph, codepoint, 0) || glyph.is_placeholder) {
            fprintf(stderr, "Missing glyph U+%04X\n", (unsigned)codepoint);
            assert(false);
        }
    }
}

int main(void)
{
    lv_init();
    size_t max_pages = 0;
    size_t multipage = 0;
    for (size_t index = 0; index < wordbook_count; index++) {
        const wordbook_entry_t *entry = &wordbook_entries[index];
        char text[2176];
        int written = snprintf(text, sizeof(text), "%s\n\n%s",
            entry->meaning[0] ? entry->meaning : WORDBOOK_NO_MEANING,
            entry->note[0] ? entry->note : WORDBOOK_NO_NOTE);
        assert(written >= 0 && (size_t)written < sizeof(text));
        check_glyphs(text);
        lv_point_t title;
        const lv_font_t *font = &lv_font_montserrat_20;
        lv_text_get_size(&title, entry->term, font, 0, 0, 204, LV_TEXT_FLAG_NONE);
        if (title.y > 48) {
            font = &lv_font_montserrat_14;
            lv_text_get_size(&title, entry->term, font, 0, 0, 204, LV_TEXT_FLAG_NONE);
        }
        assert(title.y <= 48 && title.x <= 204);
        size_t offsets[65];
        const size_t pages = wordbook_paginate(text, offsets, 65, fits, NULL);
        assert(pages > 0 && offsets[pages] == strlen(text));
        for (size_t page = 0; page < pages; page++) {
            assert(offsets[page + 1] > offsets[page]);
            assert(((unsigned char)text[offsets[page]] & 0xC0) != 0x80);
            assert(fits(text + offsets[page], offsets[page + 1] - offsets[page], NULL));
        }
        if (pages > max_pages) max_pages = pages;
        if (pages > 1) multipage++;
    }
    check_glyphs(WORDBOOK_TEXT_ERROR);
    lv_font_glyph_dsc_t missing = {0};
    bool found = lv_font_get_glyph_dsc(&wordbook_font_16, &missing, 0x10FFFF, 0);
    assert(!found || missing.is_placeholder);
    printf("Wordbook LVGL layout: PASS (%u words, %u multipage, max %u pages)\n",
           (unsigned)wordbook_count, (unsigned)multipage, (unsigned)max_pages);
    lv_deinit();
    return 0;
}