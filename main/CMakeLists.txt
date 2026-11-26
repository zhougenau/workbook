set(wordbook_data "${CMAKE_CURRENT_LIST_DIR}/../build/wordbook/wordbook_data.c")
if(NOT EXISTS "${wordbook_data}")
    set(wordbook_data "${CMAKE_CURRENT_LIST_DIR}/../assets/wordbook/sample.c")
endif()

idf_component_register(
    SRCS "wordbook_app.c" "wordbook_state.c" "wordbook_pack.c" "wordbook_sync.c" "${wordbook_data}"
         "../assets/fonts/wordbook_font_16.c"
    INCLUDE_DIRS "."
    REQUIRES bsp esp_timer nvs_flash esp_http_client esp_wifi esp_netif wifi_provisioning mbedtls
)
