#include "wordbook_data.h"

const wordbook_entry_t wordbook_entries[] = {
    {"sample-1", "journey", "旅程；旅行", "Every journey begins with one step."},
    {"sample-2", "resilient", "有韧性的；能迅速恢复的", "A resilient team learns from each challenge."},
    {"sample-3", "example", "例子；示例", "This example makes the idea clear."}
};
const size_t wordbook_count = sizeof(wordbook_entries) / sizeof(wordbook_entries[0]);