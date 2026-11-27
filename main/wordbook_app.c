#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "bsp_battery.h"
#include "bsp_button.h"
#include "bsp_display.h"
#include "bsp_pins.h"
#include "key_guard.h"
#include "wordbook_data.h"
#include "wordbook_pack.h"
#include "wordbook_sync.h"
#include "wordbook_state.h"
#include "wordbook_strings.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "lvgl.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "mbedtls/sha256.h"

LV_FONT_DECLARE(wordbook_font_16);

#define TEXT_CAPACITY 2176
#define PAGE_CAPACITY 65
#define BODY_WIDTH 204
#define BODY_HEIGHT 152
#define BODY_LINE_SPACE 4
#define SAVE_DELAY_US 1000000LL

typedef struct {
    uint32_t version;
    uint32_t page;
    char id[65];
} progress_t;

static const char *TAG = "wordbook";
static wordbook_state_t s_state;
static key_guard_t s_key_guard;
static QueueHandle_t s_input_queue;
static volatile bool s_input_ready;
static nvs_handle_t s_store;
static bool s_store_open;
static bool s_save_pending;
static bool s_save_error;
static bool s_battery_available;
static int64_t s_save_due;
static char s_text[TEXT_CAPACITY];
static char s_page[TEXT_CAPACITY];
static size_t s_offsets[PAGE_CAPACITY];
static lv_obj_t *s_term;
static lv_obj_t *s_body;
static lv_obj_t *s_progress;
static lv_obj_t *s_pages;
static lv_obj_t *s_battery;
static lv_obj_t *s_storage;
static lv_obj_t *s_bar;
static lv_obj_t *s_brand;
static const wordbook_entry_t *s_entries = wordbook_entries;
static wordbook_pack_t s_daily;
static char *s_daily_bytes;
static wordbook_state_t s_offline_position;
static bool s_syncing;
enum { WB_MENU = 6 };
static uint16_t *s_builtin_order;
static uint16_t s_daily_order[WORDBOOK_PACK_WORDS];
static wordbook_order_t s_order_mode;
static int s_choice, s_story_part = -1;
static size_t s_story_page;
static bool s_weak, s_cached;
enum { RECENT_TEN = WB_ORDER_COUNT, RECENT_TWENTY, MARK_KNOWN, MARK_UNSURE, MARK_UNKNOWN, WEAK_ONLY, OPEN_STORY, OPEN_DAILY, MENU_COUNT };
static const char *const choices[] = { "Newest first", "Oldest first", "Shuffle", "Latest 10 words", "Latest 20 words", "认识", "模糊", "不认识", "不熟词 / 全部", "今日短文", "离线今日词单" };
static uint32_t s_order_seed;
static bool s_menu, s_order_dirty;

static const wordbook_entry_t *current_entry(void)
{
    const uint16_t *indices = s_entries == wordbook_entries ? s_builtin_order : s_daily_order;
    return &s_entries[indices[s_state.word]];
}
static QueueHandle_t s_completed;
typedef struct { char *data; size_t size; } sync_result_t;
static void start_sync(unsigned command);
static void open_cached(void);
static void save_progress(void);

static bool mark_key(char key[16])
{
    uint8_t hash[32];
    const char *id = current_entry()->id;
    if (mbedtls_sha256((const unsigned char *)id, strlen(id), hash, 0)) return false;
    key[0] = 'm';
    for (size_t index = 0; index < 7; index++) snprintf(key + 1 + index * 2, 3, "%02x", hash[index]);
    return true;
}

static bool seek_weak(wordbook_action_t direction, bool include_current)
{
    wordbook_state_t before = s_state;
    for (size_t checked = 0; checked < before.count; checked++) {
        if (checked || !include_current) {
            s_state.word = direction == WORDBOOK_PREVIOUS ? (s_state.word + before.count - 1) % before.count : (s_state.word + 1) % before.count;
            s_state.page = 0;
        }
        char key[16]; uint8_t mark;
        if (s_store_open && mark_key(key) && nvs_get_u8(s_store, key, &mark) == ESP_OK && (mark == 2 || mark == 3)) return true;
    }
    s_state = before;
    return false;
}

static lv_obj_t *label_at(lv_obj_t *parent, int x, int y, int width, int height,
                          const lv_font_t *font, uint32_t color)
{
    lv_obj_t *label = lv_label_create(parent);
    lv_obj_set_pos(label, x, y);
    lv_obj_set_size(label, width, height);
    lv_label_set_long_mode(label, LV_LABEL_LONG_WRAP);
    lv_obj_set_style_text_font(label, font, 0);
    lv_obj_set_style_text_color(label, lv_color_hex(color), 0);
    lv_obj_set_style_text_letter_space(label, 0, 0);
    return label;
}

static bool text_fits(const char *text, size_t bytes, void *context)
{
    (void)context;
    if (bytes >= sizeof(s_page)) return false;
    memcpy(s_page, text, bytes);
    s_page[bytes] = '\0';
    lv_point_t size;
    lv_text_get_size(&size, s_page, &wordbook_font_16, 0, BODY_LINE_SPACE,
                     BODY_WIDTH, LV_TEXT_FLAG_NONE);
    return size.y <= BODY_HEIGHT;
}

static bool prepare_word(const wordbook_entry_t *entry)
{
    const int written = snprintf(s_text, sizeof(s_text), "%s\n\n%s",
        entry->meaning[0] ? entry->meaning : WORDBOOK_NO_MEANING,
        entry->note[0] ? entry->note : WORDBOOK_NO_NOTE);
    if (written < 0 || (size_t)written >= sizeof(s_text)) return false;
    const size_t pages = wordbook_paginate(s_text, s_offsets, PAGE_CAPACITY, text_fits, NULL);
    if (!pages) return false;
    wordbook_state_pages(&s_state, pages);
    return true;
}

static bool story_step(int direction)
{
    size_t pages = wordbook_paginate(s_daily.story[s_story_part], s_offsets, PAGE_CAPACITY, text_fits, NULL);
    if (!pages) return false;
    if ((direction > 0 && s_story_page + 1 == pages) || (direction < 0 && !s_story_page)) {
        s_story_part = (s_story_part + (direction > 0 ? 1 : 2)) % 3;
        pages = wordbook_paginate(s_daily.story[s_story_part], s_offsets, PAGE_CAPACITY, text_fits, NULL);
        if (!pages) return false;
        s_story_page = direction > 0 ? 0 : pages - 1;
    } else if (direction > 0) s_story_page++;
    else if (direction < 0) s_story_page--;
    size_t bytes = s_offsets[s_story_page + 1] - s_offsets[s_story_page];
    memcpy(s_page, s_daily.story[s_story_part] + s_offsets[s_story_page], bytes); s_page[bytes] = 0;
    lv_label_set_text(s_term, (const char *const[]){"Story", "Translation", "Target words"}[s_story_part]);
    lv_label_set_text(s_body, s_page);
    lv_label_set_text(s_progress, "2x OK: Back");
    lv_label_set_text_fmt(s_pages, "%u / %u", (unsigned)s_story_page + 1, (unsigned)pages);
    return true;
}

static void render_word(bool rebuild)
{
    if (s_story_part >= 0) {
        if (story_step(0)) return;
        s_story_part = -1;
        rebuild = true;
    }
    const wordbook_entry_t *entry = current_entry();
    bool valid = !rebuild || prepare_word(entry);
    lv_point_t term_size;
    const lv_font_t *term_font = &lv_font_montserrat_20;
    lv_text_get_size(&term_size, entry->term, term_font, 0, 0, BODY_WIDTH, LV_TEXT_FLAG_NONE);
    if (term_size.y > 48) term_font = &lv_font_montserrat_14;
    lv_obj_set_style_text_font(s_term, term_font, 0);
    lv_label_set_text(s_term, entry->term);
    if (valid) {
        const size_t start = s_offsets[s_state.page];
        const size_t bytes = s_offsets[s_state.page + 1] - start;
        memcpy(s_page, s_text + start, bytes);
        s_page[bytes] = '\0';
        lv_label_set_text(s_body, s_page);
    } else {
        wordbook_state_pages(&s_state, 1);
        lv_label_set_text(s_body, WORDBOOK_TEXT_ERROR);
        ESP_LOGE(TAG, "Cannot paginate word %u", (unsigned)s_state.word);
    }
    lv_label_set_text_fmt(s_progress, "%03u / %u", (unsigned)s_state.word + 1, (unsigned)s_state.count);
    lv_label_set_text_fmt(s_pages, "%u / %u", (unsigned)s_state.page + 1, (unsigned)s_state.pages);
    lv_bar_set_value(s_bar, (int)((s_state.word + 1) * 1000 / s_state.count), LV_ANIM_OFF);
    lv_label_set_text(s_brand, s_weak ? "WEAK WORDS" : s_daily_bytes ? "TODAY" : "WORD BOOK");
}

static void render_storage(void)
{
    lv_label_set_text(s_storage, !s_store_open ? "SAVE OFF" : s_save_error ? "SAVE ERROR" : s_menu ? "" : "2x OK: Menu");
}

static void menu_input(int action)
{
    if (!s_menu) { s_choice = s_order_mode; s_menu = true; }
    else if (action == WORDBOOK_PREVIOUS) s_choice = (s_choice + MENU_COUNT - 1) % MENU_COUNT;
    else if (action == WORDBOOK_NEXT) s_choice = (s_choice + 1) % MENU_COUNT;
    else if (action == WB_MENU || action == WORDBOOK_PAGE) {
        const char *message = NULL;
        if (action == WORDBOOK_PAGE && s_choice >= RECENT_TEN) {
            s_menu = false;
            if (s_choice == RECENT_TEN || s_choice == RECENT_TWENTY) { start_sync(s_choice == RECENT_TEN ? 10 : 20); return; }
            if (s_choice == OPEN_DAILY) { open_cached(); return; }
            if (s_choice == OPEN_STORY) {
                if (s_daily_bytes && s_daily.story[0]) { s_story_part = 0; s_story_page = 0; }
                else message = "NO STORY";
            } else if (s_choice == WEAK_ONLY) {
                s_weak = !s_weak;
                if (s_weak && !seek_weak(WORDBOOK_NEXT, true)) { s_weak = false; message = "NO WEAK WORDS"; }
            } else {
                char key[16];
                bool ok = s_store_open && mark_key(key) && nvs_set_u8(s_store, key, 1 + s_choice - MARK_KNOWN) == ESP_OK && nvs_commit(s_store) == ESP_OK;
                message = ok ? "MARK SAVED" : "SAVE ERROR";
                if (ok && s_weak && !seek_weak(WORDBOOK_NEXT, true)) s_weak = false;
            }
        } else if (action == WORDBOOK_PAGE) {
            size_t offline = s_daily_bytes ? s_builtin_order[s_offline_position.word] : 0;
            s_order_mode = s_choice;
            if (s_choice == WB_SHUFFLE) s_order_seed = esp_random();
            wordbook_order_make(s_builtin_order, wordbook_count, s_choice, s_order_seed);
            if (s_daily_bytes) {
                s_offline_position.word = wordbook_order_find(s_builtin_order, wordbook_count, offline);
                wordbook_order_make(s_daily_order, s_daily.count, s_choice, s_order_seed);
            }
            wordbook_state_init(&s_state, s_state.count, 0);
            s_order_dirty = s_store_open;
            s_weak = false;
            s_save_pending = s_store_open && (!s_daily_bytes || s_cached);
            s_save_due = esp_timer_get_time();
        }
        s_menu = false;
        render_word(true);
        render_storage();
        if (message) lv_label_set_text(s_storage, message);
        return;
    } else return;
    lv_label_set_text(s_term, "Reader menu");
    lv_label_set_text_fmt(s_body, "%s\n\n> %s\n\n%s", choices[(s_choice + MENU_COUNT - 1) % MENU_COUNT], choices[s_choice], choices[(s_choice + 1) % MENU_COUNT]);
    lv_label_set_text(s_progress, "OK: Select");
    lv_label_set_text(s_pages, "");
    lv_bar_set_value(s_bar, 0, LV_ANIM_OFF);
    render_storage();
}

static void create_screen(void)
{
    lv_obj_t *screen = lv_obj_create(NULL);
    lv_obj_remove_style_all(screen);
    lv_obj_set_size(screen, BSP_LCD_W, BSP_LCD_H);
    lv_obj_set_style_bg_color(screen, lv_color_hex(0xF4F7F5), 0);
    lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, 0);
    lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);
    s_brand = label_at(screen, 22, 16, 125, 20, &lv_font_montserrat_14, 0x007D72);
    lv_label_set_text(s_brand, "WORD BOOK");
    s_battery = label_at(screen, 155, 16, 63, 20, &lv_font_montserrat_14, 0x505B55);
    lv_obj_set_style_text_align(s_battery, LV_TEXT_ALIGN_RIGHT, 0);
    lv_label_set_text(s_battery, LV_SYMBOL_BATTERY_FULL " --");
    s_term = label_at(screen, 18, 51, BODY_WIDTH, 48, &lv_font_montserrat_20, 0x202922);
    lv_obj_t *rule = lv_obj_create(screen);
    lv_obj_remove_style_all(rule);
    lv_obj_set_pos(rule, 18, 104);
    lv_obj_set_size(rule, BODY_WIDTH, 2);
    lv_obj_set_style_bg_color(rule, lv_color_hex(0xDDE5DF), 0);
    lv_obj_set_style_bg_opa(rule, LV_OPA_COVER, 0);
    s_body = label_at(screen, 18, 116, BODY_WIDTH, BODY_HEIGHT, &wordbook_font_16, 0x202922);
    lv_obj_set_style_text_line_space(s_body, BODY_LINE_SPACE, 0);
    s_progress = label_at(screen, 22, 279, 125, 19, &lv_font_montserrat_14, 0x505B55);
    s_pages = label_at(screen, 157, 279, 61, 19, &lv_font_montserrat_14, 0x007D72);
    lv_obj_set_style_text_align(s_pages, LV_TEXT_ALIGN_RIGHT, 0);
    s_bar = lv_bar_create(screen);
    lv_obj_set_pos(s_bar, 22, 273);
    lv_obj_set_size(s_bar, 196, 2);
    lv_bar_set_range(s_bar, 0, 1000);
    lv_obj_set_style_bg_color(s_bar, lv_color_hex(0xDDE5DF), LV_PART_MAIN);
    lv_obj_set_style_bg_color(s_bar, lv_color_hex(0x007D72), LV_PART_INDICATOR);
    s_storage = label_at(screen, 65, 301, 110, 17, &lv_font_montserrat_14, 0xBA4037);
    lv_obj_set_style_text_align(s_storage, LV_TEXT_ALIGN_CENTER, 0);
    render_word(true);
    render_storage();
    lv_screen_load(screen);
}

static void restore_progress(void)
{
    wordbook_state_init(&s_state, wordbook_count, 0);
    wordbook_order_make(s_builtin_order, wordbook_count, WB_NEWEST, 0);
    esp_err_t result = nvs_flash_init();
    if (result == ESP_OK) result = nvs_open("wordbook", NVS_READWRITE, &s_store);
    s_store_open = result == ESP_OK;
    if (!s_store_open) {
        ESP_LOGW(TAG, "Progress disabled: %s; NVS was not erased", esp_err_to_name(result));
        return;
    }
    uint64_t preference;
    if (nvs_get_u64(s_store, "order", &preference) == ESP_OK && (preference >> 32) < WB_ORDER_COUNT) {
        s_order_mode = (wordbook_order_t)(preference >> 32);
        s_order_seed = (uint32_t)preference;
        wordbook_order_make(s_builtin_order, wordbook_count, s_order_mode, s_order_seed);
    }
    progress_t saved = {0};
    size_t size = sizeof(saved);
    if (nvs_get_blob(s_store, "progress", &saved, &size) != ESP_OK ||
        size != sizeof(saved) || saved.version != 1 || !memchr(saved.id, '\0', sizeof(saved.id))) return;
    for (size_t index = 0; index < wordbook_count; index++) {
        if (strcmp(wordbook_entries[index].id, saved.id) == 0) {
            s_state.word = wordbook_order_find(s_builtin_order, wordbook_count, index);
            s_state.page = saved.page;
            break;
        }
    }
}

static void save_progress(void)
{
    progress_t saved = { .version = 1, .page = (uint32_t)s_state.page };
    snprintf(saved.id, sizeof(saved.id), "%s", current_entry()->id);
    esp_err_t result = nvs_set_blob(s_store, s_daily_bytes ? "daily_pos" : "progress", &saved, sizeof(saved));
    if (result == ESP_OK) result = nvs_commit(s_store);
    s_save_error = result != ESP_OK;
    if (s_save_error) {
        ESP_LOGW(TAG, "Progress save failed: %s", esp_err_to_name(result));
        s_save_due = esp_timer_get_time() + 5000000LL;
    } else {
        s_save_pending = false;
    }
}

static void sync_status(const char *message)
{
    static lv_obj_t *qr;
    if (bsp_lvgl_lock(1000)) {
        if (qr) { lv_obj_delete(qr); qr = NULL; }
        if (strncmp(message, "WBPAIR1:", 8) == 0) {
            lv_label_set_text(s_term, "Scan in WeChat");
            lv_label_set_text(s_body, "");
            qr = lv_qrcode_create(lv_obj_get_parent(s_body));
            if (qr) {
                lv_qrcode_set_size(qr, 148);
                lv_obj_set_pos(qr, 46, 118);
                lv_qrcode_set_quiet_zone(qr, true);
                lv_qrcode_set_dark_color(qr, lv_color_black());
                lv_qrcode_set_light_color(qr, lv_color_white());
            }
            if (!qr || lv_qrcode_update(qr, message, strlen(message)) != LV_RESULT_OK) {
                if (qr) { lv_obj_delete(qr); qr = NULL; }
                lv_label_set_text(s_body, "QR unavailable");
            }
        } else {
            lv_label_set_text(s_term, "Today sync");
            lv_label_set_text(s_body, message);
        }
        bsp_lvgl_unlock();
    }
}

static void sync_worker(void *argument)
{
    sync_result_t result = {0};
    unsigned command = (unsigned)(uintptr_t)argument;
    result.data = wordbook_sync_fetch(command == 4, command == 10 || command == 20 ? command : 0, sync_status, &result.size);
    xQueueSend(s_completed, &result, portMAX_DELAY);
    vTaskDelete(NULL);
}

static void start_sync(unsigned command)
{
    if (s_save_pending) { save_progress(); if (s_save_pending) { render_storage(); return; } }
    lv_label_set_text(s_term, "Today sync"); lv_label_set_text(s_body, "Starting wireless...");
    s_syncing = xTaskCreate(sync_worker, "wb_sync", 8192, (void *)(uintptr_t)command, 4, NULL) == pdPASS;
    if (!s_syncing) lv_label_set_text(s_storage, "NO RAM");
}

static void apply_download(sync_result_t result, bool cached)
{
    wordbook_pack_t pack;
    bool valid = wordbook_pack_parse(result.data, result.size, &pack);
    const wordbook_state_t before = s_state;
    const wordbook_entry_t *prior = s_entries;
    if (valid) {
        s_entries = pack.entries;
        wordbook_state_init(&s_state, pack.count, 0);
        for (size_t index = 0; index < pack.count; index++) {
            s_state.word = index;
            if (!prepare_word(&pack.entries[index])) { valid = false; break; }
        }
    }
    if (valid) {
        if (prior == wordbook_entries) s_offline_position = before;
        s_daily = pack;
        wordbook_order_make(s_daily_order, pack.count, s_order_mode, s_order_seed);
        s_entries = s_daily.entries;
        free(s_daily_bytes);
        s_daily_bytes = result.data;
        wordbook_state_init(&s_state, pack.count, 0);
        s_weak = false;
        if (cached && s_store_open) {
            progress_t saved = {0}; size_t length = sizeof(saved);
            if (nvs_get_blob(s_store, "daily_pos", &saved, &length) == ESP_OK && length == sizeof(saved) && saved.version == 1 && memchr(saved.id, 0, sizeof(saved.id))) {
                for (size_t index = 0; index < pack.count; index++) if (!strcmp(pack.entries[index].id, saved.id)) {
                    s_state.word = wordbook_order_find(s_daily_order, pack.count, index); s_state.page = saved.page; break;
                }
            }
        }
    } else {
        free(result.data);
        s_entries = prior;
        s_state = before;
    }
    lv_label_set_text(s_brand, s_daily_bytes ? "TODAY" : "WORD BOOK");
    render_word(true);
    if (valid) {
        s_cached = s_store_open && (cached || nvs_set_blob(s_store, "daily_pack", result.data, result.size) == ESP_OK);
        if (s_cached) s_cached = nvs_set_u8(s_store, "daily_active", 1) == ESP_OK && nvs_commit(s_store) == ESP_OK;
        lv_label_set_text(s_storage, s_cached ? cached ? "OFFLINE" : "SAVED" : "RAM ONLY");
        s_save_pending = s_cached && !cached;
        s_save_due = esp_timer_get_time();
    } else lv_label_set_text(s_storage, "PACK REJECTED");
}

static void open_cached(void)
{
    if (s_save_pending) {
        save_progress();
        if (s_save_pending) { render_word(true); render_storage(); return; }
    }
    size_t size = 0;
    if (s_store_open && nvs_get_blob(s_store, "daily_pack", NULL, &size) == ESP_OK && size && size <= WORDBOOK_PACK_LIMIT) {
        char *data = malloc(size);
        if (data && nvs_get_blob(s_store, "daily_pack", data, &size) == ESP_OK) { apply_download((sync_result_t){data, size}, true); return; }
        free(data);
    }
    render_word(true); lv_label_set_text(s_storage, "NO SAVED LIST");
}

static void reader_task(void *argument)
{
    (void)argument;
    uint8_t active = 0;
    if (s_store_open && nvs_get_u8(s_store, "daily_active", &active) == ESP_OK && active && bsp_lvgl_lock(2000)) {
        open_cached();
        bsp_lvgl_unlock();
    }
    int64_t next_battery = 0;
    int64_t last_action = esp_timer_get_time();
    int brightness = 75;
    for (;;) {
        int action;
        sync_result_t completed;
        if (s_syncing && uxQueueMessagesWaiting(s_completed) && bsp_lvgl_lock(1000)) {
            if (xQueueReceive(s_completed, &completed, 0) == pdTRUE) {
                s_syncing = false;
                if (completed.data) apply_download(completed, false);
                else lv_label_set_text(s_storage, "PRESS A KEY");
            }
            bsp_lvgl_unlock();
        }
        if (xQueueReceive(s_input_queue, &action, pdMS_TO_TICKS(250)) == pdTRUE) {
            last_action = esp_timer_get_time();
            if (s_syncing) continue;
            if ((action == 3 || action == 4) && s_save_pending) {
                save_progress();
                if (s_save_pending) continue;
            }
            if (bsp_lvgl_lock(1000)) {
                if (s_story_part >= 0) {
                    if (action == WB_MENU || action == 5 || (action <= WORDBOOK_PAGE && !story_step(action == WORDBOOK_PREVIOUS ? -1 : 1))) {
                        s_story_part = -1; render_word(true); render_storage();
                    }
                } else if (action == WB_MENU || s_menu) {
                    menu_input(action);
                } else if (action == 3 || action == 4) {
                    start_sync((unsigned)action);
                } else if (action == 5 || lv_label_get_text(s_storage)[0] == 'P') {
                    if (action == 5 && s_daily_bytes) {
                        if (s_save_pending) save_progress();
                        if (s_save_pending || (s_store_open && (nvs_set_u8(s_store, "daily_active", 0) != ESP_OK || nvs_commit(s_store) != ESP_OK))) {
                            lv_label_set_text(s_storage, "SAVE ERROR"); bsp_lvgl_unlock(); continue;
                        }
                        s_weak = false;
                        s_entries = wordbook_entries;
                        s_state = s_offline_position;
                        free(s_daily_bytes); s_daily_bytes = NULL;
                        lv_label_set_text(s_brand, "WORD BOOK");
                    }
                    render_word(true);
                    render_storage();
                } else {
                const size_t previous_word = s_state.word;
                if (s_weak && action != WORDBOOK_PAGE ? seek_weak((wordbook_action_t)action, false) : wordbook_state_step(&s_state, (wordbook_action_t)action)) {
                    render_word(previous_word != s_state.word);
                    s_save_pending = s_store_open && (!s_daily_bytes || s_cached);
                    s_save_due = esp_timer_get_time() + SAVE_DELAY_US;
                }
                }
                bsp_lvgl_unlock();
            }
        }
        const int64_t now = esp_timer_get_time();
        if (s_order_dirty) {
            uint64_t preference = ((uint64_t)s_order_mode << 32) | s_order_seed;
            esp_err_t result = nvs_set_u64(s_store, "order", preference);
            if (result == ESP_OK) result = nvs_commit(s_store);
            s_order_dirty = false;
            if (result != ESP_OK && bsp_lvgl_lock(1000)) {
                lv_label_set_text(s_storage, "ORDER NOT SAVED");
                bsp_lvgl_unlock();
            }
        }
        const int requested = s_syncing ? 75 : wordbook_idle_brightness(now - last_action);
        if (requested != brightness) {
            bsp_display_backlight(requested);
            brightness = requested;
        }
        if (s_save_pending && now >= s_save_due) {
            save_progress();
            if (bsp_lvgl_lock(1000)) {
                render_storage();
                bsp_lvgl_unlock();
            }
        }
        if (now >= next_battery) {
            const int soc = s_battery_available ? bsp_battery_soc() : -1;
            if (bsp_lvgl_lock(1000)) {
                if (soc >= 0 && soc <= 100) lv_label_set_text_fmt(s_battery, LV_SYMBOL_BATTERY_FULL " %d%%", soc);
                else lv_label_set_text(s_battery, LV_SYMBOL_BATTERY_FULL " --");
                bsp_lvgl_unlock();
            }
            next_battery = now + 30000000LL;
        }
    }
}

static void on_key(bsp_btn_t button, bsp_btn_ev_t event, void *user)
{
    (void)user;
    if (key_guard_consume(&s_key_guard, event == BSP_BTN_RELEASE, esp_timer_get_time())) return;
    if (!s_input_ready || !s_input_queue) return;
    if (event == BSP_BTN_LONG) {
        int command = button == BSP_BTN_OK ? 3 : button == BSP_BTN_DOWN ? 4 : 5;
        (void)xQueueSend(s_input_queue, &command, 0);
        return;
    }
    if (event != BSP_BTN_CLICK && event != BSP_BTN_DOUBLE) return;
    if (button == BSP_BTN_OK && event == BSP_BTN_DOUBLE) {
        int command = WB_MENU;
        (void)xQueueSend(s_input_queue, &command, 0);
        return;
    }
    int action;
    if (button == BSP_BTN_UP) action = WORDBOOK_PREVIOUS;
    else if (button == BSP_BTN_DOWN) action = WORDBOOK_NEXT;
    else if (button == BSP_BTN_OK) action = WORDBOOK_PAGE;
    else return;
    const unsigned repeats = event == BSP_BTN_DOUBLE ? 2 : 1;
    for (unsigned index = 0; index < repeats; index++) (void)xQueueSend(s_input_queue, &action, 0);
}

void app_main(void)
{
    ESP_LOGI(TAG, "Wordbook 0.1.0; %u offline words", (unsigned)wordbook_count);
    if (!wordbook_count) {
        ESP_LOGE(TAG, "Empty word pack");
        return;
    }
    s_builtin_order = calloc(wordbook_count, sizeof(*s_builtin_order));
    if (!s_builtin_order) { ESP_LOGE(TAG, "No RAM for word order"); return; }
    restore_progress();
    s_battery_available = bsp_battery_init() == ESP_OK;
    if (bsp_display_init() != ESP_OK || !bsp_lvgl_init()) {
        ESP_LOGE(TAG, "Display initialization failed");
        return;
    }
    if (!bsp_lvgl_lock(2000)) {
        ESP_LOGE(TAG, "Display lock failed");
        return;
    }
    create_screen();
    bsp_lvgl_unlock();
    bsp_display_backlight(75);
    s_completed = xQueueCreate(1, sizeof(sync_result_t));
    s_input_queue = xQueueCreate(12, sizeof(int));
    if (!s_input_queue || !s_completed) {
        ESP_LOGE(TAG, "Input queue allocation failed");
        return;
    }
    key_guard_arm(&s_key_guard, esp_timer_get_time(), 10000000LL);
    if (bsp_button_init(on_key, NULL) != ESP_OK) {
        ESP_LOGE(TAG, "Button initialization failed");
        return;
    }
    key_guard_sync_released(&s_key_guard, bsp_button_read_mv() >= BSP_BTN_MV_RELEASED_MIN);
    if (xTaskCreate(reader_task, "wordbook", 6144, NULL, 4, NULL) != pdPASS) {
        ESP_LOGE(TAG, "Reader task allocation failed");
        return;
    }
    s_input_ready = true;
    ESP_LOGI(TAG, "Ready; free heap=%u, largest block=%u",
        (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL),
        (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL));
}