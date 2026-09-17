#include "WifiConnection.h"

#include <WiFi.h>

#include "AppConfig.h"

void WifiConnection::begin() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  // Без modem sleep: команды приходят без задержек, и нет помех на GPIO36/39 (errata ESP32), куда подключён HX711
  WiFi.setSleep(false);
  WiFi.onEvent([this](arduino_event_id_t, arduino_event_info_t info) {
    // ASSOC_LEAVE — это наш собственный disconnect() перед переподключением, а не ошибка.
    // События от прошлой сети могут прийти уже после смены настроек — их тоже пропускаем
    const auto &event = info.wifi_sta_disconnected;
    String ssid(reinterpret_cast<const char *>(event.ssid), event.ssid_len);
    if (event.reason != WIFI_REASON_ASSOC_LEAVE && ssid == settings_.ssid) {
      lastReason_ = event.reason;
    }
  }, ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
}

bool WifiConnection::connected() const {
  return WiFi.status() == WL_CONNECTED;
}

void WifiConnection::configure(const NetworkSettings &settings) {
  bool sameNetwork = settings.ssid == settings_.ssid && settings.username == settings_.username && settings.password == settings_.password;
  settings_ = settings;
  // Сменился только сервер: рвать рабочее подключение незачем
  if (sameNetwork && connected()) {
    lastReason_ = 0;
    return;
  }
  if (settings_.ssid.isEmpty()) {
    WiFi.disconnect();
    return;
  }
  connect();
}

unsigned long WifiConnection::attemptAgeMs() const {
  return millis() - attemptStartedMs_;
}

void WifiConnection::update() {
  if (scanning_) {
    int16_t result = WiFi.scanComplete();
    if (result != WIFI_SCAN_RUNNING) {
      scanning_ = false;
      scanReady_ = true;
      if (resumeAfterScan_) {
        resumeAfterScan_ = false;
        connect();
      }
    }
  }

  bool isConnected = connected();
  if (isConnected && !wasConnected_) {
    Serial.printf("[wifi] connected to %s, IP %s, RSSI %d dBm\n", settings_.ssid.c_str(), WiFi.localIP().toString().c_str(), WiFi.RSSI());
  }
  if (!isConnected && wasConnected_) {
    Serial.println("[wifi] connection lost");
    attemptStartedMs_ = millis();
  }
  wasConnected_ = isConnected;

  // Поиск сетей мешает подключению, поэтому повторная попытка ждёт его окончания
  if (attempting() && !isConnected && !scanning_ && attemptAgeMs() > AppConfig::WIFI_CONNECT_TIMEOUT_MS) {
    Serial.printf(
      "[wifi] still not connected to %s (status %d, reason %u: %s), retrying\n", settings_.ssid.c_str(), WiFi.status(), lastReason_.load(),
      describeReason(lastReason_.load())
    );
    connect();
  }
}

void WifiConnection::connect() {
  // disconnect() асинхронный: begin() сразу после него драйвер может проигнорировать
  if (WiFi.status() == WL_CONNECTED) {
    WiFi.disconnect();
    unsigned long startedMs = millis();
    while (WiFi.status() == WL_CONNECTED && millis() - startedMs < AppConfig::WIFI_DISCONNECT_WAIT_MS) {
      delay(20);
    }
  } else {
    WiFi.disconnect();
  }
  delay(100);
  lastReason_ = 0;
  if (settings_.enterprise()) {
    Serial.printf("[wifi] connecting to %s (WPA2 Enterprise, user %s)\n", settings_.ssid.c_str(), settings_.username.c_str());
    WiFi.begin(settings_.ssid.c_str(), WPA2_AUTH_PEAP, settings_.username.c_str(), settings_.username.c_str(), settings_.password.c_str());
  } else if (settings_.password.isEmpty()) {
    Serial.printf("[wifi] connecting to %s (open)\n", settings_.ssid.c_str());
    WiFi.begin(settings_.ssid.c_str());
  } else {
    Serial.printf("[wifi] connecting to %s (password)\n", settings_.ssid.c_str());
    WiFi.begin(settings_.ssid.c_str(), settings_.password.c_str());
  }
  attemptStartedMs_ = millis();
}

void WifiConnection::startScan() {
  if (scanning_) {
    return;
  }
  WiFi.scanDelete();
  scanReady_ = false;
  // Пока драйвер пытается подключиться, поиск сразу завершается ошибкой: попытку прерываем и после поиска
  // начинаем заново. Так бывает, когда бокс унесли туда, где его сети нет
  if (attempting() && !connected()) {
    WiFi.disconnect();
    delay(100);
    resumeAfterScan_ = true;
  }
  scanning_ = WiFi.scanNetworks(true) == WIFI_SCAN_RUNNING;
  if (!scanning_) {
    Serial.println("[wifi] network scan failed to start");
    scanReady_ = true;
    if (resumeAfterScan_) {
      resumeAfterScan_ = false;
      connect();
    }
  }
}

// ESP32 работает только на 2.4 ГГц. Сети с одинаковым именем схлопываются (остаётся самая сильная — список
// уже отсортирован по уровню сигнала), скрытые пропускаются
void WifiConnection::takeScanResults(JsonArray networks) {
  int16_t count = WiFi.scanComplete();
  size_t added = 0;
  for (int16_t i = 0; i < count && added < AppConfig::WIFI_SCAN_LIMIT; ++i) {
    String ssid = WiFi.SSID(i);
    if (ssid.isEmpty()) {
      continue;
    }
    bool duplicate = false;
    for (JsonObject network : networks) {
      if (ssid == network["ssid"].as<const char *>()) {
        duplicate = true;
        break;
      }
    }
    if (duplicate) {
      continue;
    }
    Serial.printf("[wifi] scan: %s ch %d %d dBm auth %d\n", ssid.c_str(), static_cast<int>(WiFi.channel(i)), static_cast<int>(WiFi.RSSI(i)), static_cast<int>(WiFi.encryptionType(i)));
    JsonObject network = networks.add<JsonObject>();
    network["ssid"] = ssid;
    network["rssi"] = WiFi.RSSI(i);
    network["auth"] = authName(WiFi.encryptionType(i));
    ++added;
  }
  WiFi.scanDelete();
  scanReady_ = false;
}

void WifiConnection::setPowerSave(bool enabled) {
  WiFi.setSleep(enabled);
}

const char *WifiConnection::authName(int authMode) {
  switch (authMode) {
    case WIFI_AUTH_OPEN:
    case WIFI_AUTH_OWE:
      return "open";
    case WIFI_AUTH_WPA2_ENTERPRISE:
    case WIFI_AUTH_WPA3_ENTERPRISE:
    case WIFI_AUTH_WPA2_WPA3_ENTERPRISE:
    case WIFI_AUTH_WPA3_ENT_192:
      return "enterprise";
    default:
      return "password";
  }
}

const char *WifiConnection::describeReason(uint8_t reason) {
  switch (reason) {
    case 0:
      return "none";
    case WIFI_REASON_NO_AP_FOUND:
      return "network not found (ESP32 sees only 2.4 GHz)";
    case WIFI_REASON_AUTH_FAIL:
    case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT:
    case WIFI_REASON_HANDSHAKE_TIMEOUT:
    case WIFI_REASON_802_1X_AUTH_FAILED:
      return "authentication failed, check login and password";
    case WIFI_REASON_ASSOC_FAIL:
    case WIFI_REASON_AUTH_EXPIRE:
      return "access point rejected the connection";
    case WIFI_REASON_BEACON_TIMEOUT:
      return "signal lost";
    default:
      return "connection failed";
  }
}
