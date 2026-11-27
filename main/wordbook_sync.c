#include "wordbook_sync.h"
#include "wordbook_pack.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "esp_crt_bundle.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "mbedtls/sha256.h"
#include "nvs.h"
#include "esp_wifi.h"
#include "esp_wifi_default.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "wifi_provisioning/manager.h"
#include "wifi_provisioning/scheme_ble.h"

typedef struct { char *data; size_t size; bool overflow; } response_t;

static esp_err_t receive(esp_http_client_event_t *event)
{
    response_t *body = event->user_data;
    if (event->event_id == HTTP_EVENT_ON_DATA && event->data_len > 0) {
        if ((size_t)event->data_len > WORDBOOK_PACK_LIMIT - body->size) body->overflow = true;
        else if (!body->overflow) {
            memcpy(body->data + body->size, event->data, event->data_len);
            body->size += event->data_len;
        }
    }
    return ESP_OK;
}

static void hex32(const uint8_t bytes[32], char text[65])
{
    static const char digits[] = "0123456789abcdef";
    for (size_t index = 0; index < 32; index++) {
        text[index * 2] = digits[bytes[index] >> 4];
        text[index * 2 + 1] = digits[bytes[index] & 15];
    }
    text[64] = '\0';
}

static bool device_identity(char secret[65], char qr[73])
{
    nvs_handle_t store;
    if (nvs_open("wordbook", NVS_READWRITE, &store) != ESP_OK) return false;
    uint8_t bytes[32];
    size_t length = sizeof(bytes);
    esp_err_t result = nvs_get_blob(store, "pair_key", bytes, &length);
    if (result == ESP_ERR_NVS_NOT_FOUND) {
        esp_fill_random(bytes, sizeof(bytes));
        result = nvs_set_blob(store, "pair_key", bytes, sizeof(bytes));
        if (result == ESP_OK) result = nvs_commit(store);
        length = sizeof(bytes);
    }
    nvs_close(store);
    if (result != ESP_OK || length != sizeof(bytes)) return false;
    hex32(bytes, secret);
    if (mbedtls_sha256((const unsigned char *)secret, 64, bytes, 0) != 0) return false;
    memcpy(qr, "WBPAIR1:", 8);
    hex32(bytes, qr + 8);
    return true;
}

static int fetch_once(const char *secret, const char *pin, response_t *body)
{
    esp_http_client_config_t config = {
        .url = "https://gvgztuwklhlhzorcoouh.supabase.co/functions/v1/passport-bound",
        .method = HTTP_METHOD_POST, .crt_bundle_attach = esp_crt_bundle_attach,
        .timeout_ms = 6000, .disable_auto_redirect = true, .event_handler = receive, .user_data = body,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) return -1;
    int result = -1;
    body->size = 0;
    body->overflow = false;
    if (esp_http_client_set_header(client, "X-Passport-Device", secret) == ESP_OK &&
        (!pin || esp_http_client_set_header(client, "X-Passport-Start", pin) == ESP_OK) &&
        esp_http_client_set_post_field(client, "", 0) == ESP_OK && esp_http_client_perform(client) == ESP_OK && !body->overflow)
        result = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);
    return result;
}

char *wordbook_sync_fetch(bool forget_wifi, wordbook_status_t status, size_t *size)
{
    bool wifi = false, manager = false, clock = false, success = false;
    esp_netif_t *net = NULL;
    const char *failure = "Wi-Fi unavailable";
    response_t body = {0};
    char proof[9], name[16], code[5], message[90], secret[65], qr[73];
    uint8_t mac[6];
    *size = 0;
    if (esp_netif_init() != ESP_OK) goto done;
    esp_err_t err = esp_event_loop_create_default();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) goto done;
    esp_netif_config_t settings = ESP_NETIF_DEFAULT_WIFI_STA();
    net = esp_netif_new(&settings);
    if (!net || esp_netif_attach_wifi_station(net) != ESP_OK || esp_wifi_set_default_wifi_sta_handlers() != ESP_OK) goto done;
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    if (esp_wifi_init(&init) != ESP_OK) goto done;
    wifi = true;
    if (esp_wifi_set_mode(WIFI_MODE_STA) != ESP_OK || esp_wifi_start() != ESP_OK || esp_wifi_get_mac(WIFI_IF_STA, mac) != ESP_OK) goto done;
    wifi_prov_mgr_config_t prov = { .scheme = wifi_prov_scheme_ble, .scheme_event_handler = WIFI_PROV_EVENT_HANDLER_NONE };
    if (wifi_prov_mgr_init(prov) != ESP_OK) goto done;
    manager = true;
    bool configured = false;
    if (wifi_prov_mgr_is_provisioned(&configured) != ESP_OK) goto done;
    if (forget_wifi || !configured) {
        snprintf(proof, sizeof(proof), "%08lx", (unsigned long)esp_random());
        snprintf(name, sizeof(name), "PROV_%02X%02X%02X", mac[3], mac[4], mac[5]);
        snprintf(message, sizeof(message), "BLE: %s\nPoP: %s", name, proof);
        status(message);
        if (wifi_prov_mgr_start_provisioning(WIFI_PROV_SECURITY_1, proof, name, NULL) != ESP_OK) goto done;
    } else {
        status("Connecting to Wi-Fi");
        if (esp_wifi_connect() != ESP_OK) goto done;
    }
    int64_t deadline = esp_timer_get_time() + (configured && !forget_wifi ? 20000000LL : 120000000LL);
    esp_netif_ip_info_t ip = {0};
    while (esp_timer_get_time() < deadline) {
        if (esp_netif_get_ip_info(net, &ip) == ESP_OK && ip.ip.addr) break;
        vTaskDelay(pdMS_TO_TICKS(200));
    }
    if (!ip.ip.addr) { failure = "Wi-Fi timed out"; goto done; }
    wifi_prov_mgr_deinit(); manager = false;
    esp_sntp_config_t time_config = ESP_NETIF_SNTP_DEFAULT_CONFIG("pool.ntp.org");
    if (esp_netif_sntp_init(&time_config) != ESP_OK) goto done;
    clock = true;
    if (esp_netif_sntp_sync_wait(pdMS_TO_TICKS(12000)) != ESP_OK) { failure = "Time sync failed"; goto done; }
    body.data = malloc(WORDBOOK_PACK_LIMIT);
    if (!body.data) { failure = "Not enough RAM"; goto done; }
    if (!device_identity(secret, qr)) { failure = "Device key unavailable"; goto done; }
    snprintf(code, sizeof(code), "%04u", (unsigned)(esp_random() % 10000U));
    deadline = esp_timer_get_time() + 120000000LL;
    bool shown = false;
    for (;;) {
        int result = fetch_once(secret, code, &body);
        if (result == 200) break;
        if (result != 403) { failure = "Sync service unavailable"; goto done; }
        if (esp_timer_get_time() >= deadline) { failure = "Pairing timed out"; goto done; }
        if (!shown) { status(qr); shown = true; }
        vTaskDelay(pdMS_TO_TICKS(4000));
    }
    snprintf(message, sizeof(message), "Web code:\n%s", code);
    status(message);
    deadline = esp_timer_get_time() + 120000000LL;
    failure = "No pack received";
    while (esp_timer_get_time() < deadline) {
        int result = fetch_once(secret, NULL, &body);
        if (result == 200 && body.size) { success = true; break; }
        if (result != 404) { failure = "Download failed"; break; }
        vTaskDelay(pdMS_TO_TICKS(4000));
    }
done:
    if (manager) wifi_prov_mgr_deinit();
    if (clock) esp_netif_sntp_deinit();
    if (wifi) { esp_wifi_stop(); esp_wifi_deinit(); }
    if (net) esp_netif_destroy_default_wifi(net);
    if (!success) { free(body.data); status(failure); return NULL; }
    *size = body.size;
    return body.data;
}