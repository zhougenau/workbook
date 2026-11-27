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

static uint16_t display_pixels[64 * 48];
static unsigned ink_pixels;

static void count_ink(lv_display_t *display, const lv_area_t *area, uint8_t *pixels)
{
    const uint16_t *colors = (const uint16_t *)pixels;
    for (int32_t index = 0; index < lv_area_get_size(area); index++) {
        if (colors[index] != 0) ink_pixels++;
    }
    lv_display_flush_ready(display);
}

static void check_placeholder(void)
{
    lv_display_t *display = lv_display_create(64, 48);
    lv_display_set_buffers(display, display_pixels, NULL, sizeof(display_pixels), LV_DISPLAY_RENDER_MODE_FULL);
    lv_display_set_flush_cb(display, count_ink);
    lv_obj_t *screen = lv_display_get_screen_active(display);
    lv_obj_set_style_bg_color(screen, lv_color_black(), 0);
    lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, 0);
    lv_obj_t *label = lv_label_create(screen);
    lv_obj_set_style_text_font(label, &wordbook_font_16, 0);
    lv_obj_set_style_text_color(label, lv_color_white(), 0);
    lv_label_set_text(label, " ");
    lv_refr_now(display);
    assert(ink_pixels == 0);
    lv_font_glyph_dsc_t glyph = {0};
    lv_font_get_glyph_dsc(&wordbook_font_16, &glyph, 0x20000, 0);
    assert(glyph.is_placeholder && glyph.adv_w > 0);
    lv_label_set_text(label, "\xF0\xA0\x80\x80");
    lv_refr_now(display);
    assert(ink_pixels > 0);
    lv_display_delete(display);
}

int main(void)
{
    lv_init();
    check_placeholder();
    const char *const sections[] = { "After sunset the travelers returned home. ", "日落之后，他们终于回到了家。" };
    for (size_t part = 0; part < 2; part++) {
        char section[2049] = {0};
        size_t length = strlen(sections[part]);
        size_t used = 0;
        while (used + length < sizeof(section)) {
            memcpy(section + used, sections[part], length);
            used += length;
        }
        size_t offsets[65];
        size_t pages = wordbook_paginate(section, offsets, 65, fits, NULL);
        assert(pages > 1 && offsets[pages] == used);
        for (size_t page = 0; page < pages; page++) {
            assert(((unsigned char)section[offsets[page]] & 0xc0) != 0x80);
            assert(fits(section + offsets[page], offsets[page + 1] - offsets[page], NULL));
        }
    }
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