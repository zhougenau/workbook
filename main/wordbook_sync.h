#pragma once
#include <stdbool.h>
#include <stddef.h>

typedef void (*wordbook_status_t)(const char *message);
char *wordbook_sync_fetch(bool forget_wifi, unsigned recent, wordbook_status_t status, size_t *size);