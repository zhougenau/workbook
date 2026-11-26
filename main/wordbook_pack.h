#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "wordbook_data.h"

#define WORDBOOK_PACK_LIMIT 16384
#define WORDBOOK_PACK_WORDS 20

typedef struct {
    wordbook_entry_t entries[WORDBOOK_PACK_WORDS];
    size_t count;
} wordbook_pack_t;

bool wordbook_pack_parse(const char *data, size_t size, bool (*glyph)(uint32_t), wordbook_pack_t *out);