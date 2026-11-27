#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "wordbook_data.h"

#define WORDBOOK_PACK_LIMIT 16384
#define WORDBOOK_PACK_WORDS 20

typedef struct {
    wordbook_entry_t entries[WORDBOOK_PACK_WORDS];
    size_t count;
    const char *story[3];
} wordbook_pack_t;

bool wordbook_pack_parse(const char *data, size_t size, wordbook_pack_t *out);