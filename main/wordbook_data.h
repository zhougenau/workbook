#pragma once

#include <stddef.h>

typedef struct {
    const char *id;
    const char *term;
    const char *meaning;
    const char *note;
} wordbook_entry_t;

extern const wordbook_entry_t wordbook_entries[];
extern const size_t wordbook_count;