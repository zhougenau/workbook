#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
    size_t count;
    size_t word;
    size_t page;
    size_t pages;
} wordbook_state_t;

typedef enum {
    WORDBOOK_PREVIOUS,
    WORDBOOK_NEXT,
    WORDBOOK_PAGE
} wordbook_action_t;

typedef enum { WB_NEWEST, WB_OLDEST, WB_SHUFFLE, WB_ORDER_COUNT } wordbook_order_t;
void wordbook_order_make(uint16_t *indices, size_t count, wordbook_order_t mode, uint32_t seed);
size_t wordbook_order_find(const uint16_t *indices, size_t count, size_t entry);

void wordbook_state_init(wordbook_state_t *state, size_t count, size_t restored);
void wordbook_state_pages(wordbook_state_t *state, size_t pages);
bool wordbook_state_step(wordbook_state_t *state, wordbook_action_t action);

typedef bool (*wordbook_fits_t)(const char *text, size_t bytes, void *context);
size_t wordbook_paginate(const char *text, size_t *offsets, size_t capacity,
                         wordbook_fits_t fits, void *context);
int wordbook_idle_brightness(int64_t inactive_us);