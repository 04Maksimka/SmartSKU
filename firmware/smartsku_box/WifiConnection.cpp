#include "WifiConnection.h"

#include <WiFi.h>

#include "AppConfig.h"
#include "secrets.h"

void WifiConnection::begin() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  // Без modem sleep: команды приходят без задержек, и нет помех на GPIO36/39 (errata ESP32), куда подключён HX711
  WiFi.setSleep(false);
  printNearbyNetworks();
  connect();
}

bool WifiConnection::connected() const {
  return WiFi.status() == WL_CONNECTED;
}

void WifiConnection::update() {
  bool isConnected = connected();
  if (isConnected && !wasConnected_) {
    Serial.printf("[wifi] connected, IP %s, RSSI %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  }
  if (!isConnected && wasConnected_) {
    Serial.println("[wifi] connection lost");
    attemptStartedMs_ = millis();
  }
  wasConnected_ = isConnected;

  if (!isConnected && millis() - attemptStartedMs_ > AppConfig::WIFI_CONNECT_TIMEOUT_MS) {
    Serial.printf("[wifi] still not connected (status %d), retrying\n", WiFi.status());
    connect();
  }
}

void WifiConnection::connect() {
  WiFi.disconnect();
  if (strlen(Secrets::EAP_USERNAME) > 0) {
    Serial.printf("[wifi] connecting to %s (WPA2 Enterprise, user %s)\n", Secrets::WIFI_SSID, Secrets::EAP_USERNAME);
    WiFi.begin(Secrets::WIFI_SSID, WPA2_AUTH_PEAP, Secrets::EAP_IDENTITY, Secrets::EAP_USERNAME, Secrets::WIFI_PASSWORD);
  } else {
    Serial.printf("[wifi] connecting to %s (password)\n", Secrets::WIFI_SSID);
    WiFi.begin(Secrets::WIFI_SSID, Secrets::WIFI_PASSWORD);
  }
  attemptStartedMs_ = millis();
}

// ESP32 работает только на 2.4 ГГц: если нужной сети нет в списке, подключиться не получится
void WifiConnection::printNearbyNetworks() const {
  int count = WiFi.scanNetworks();
  Serial.printf("[wifi] %d networks visible (ESP32 sees only 2.4 GHz):\n", count);
  bool targetVisible = false;
  String similarSsid;
  for (int i = 0; i < count; ++i) {
    if (WiFi.SSID(i) == Secrets::WIFI_SSID) {
      targetVisible = true;
    } else if (WiFi.SSID(i).equalsIgnoreCase(Secrets::WIFI_SSID)) {
      similarSsid = WiFi.SSID(i);
    }
    if (i < AppConfig::WIFI_SCAN_PRINT_LIMIT) {
      bool enterprise = WiFi.encryptionType(i) == WIFI_AUTH_WPA2_ENTERPRISE;
      Serial.printf(
        "  %-32s ch %2d  %4d dBm%s\n", WiFi.SSID(i).c_str(), static_cast<int>(WiFi.channel(i)), static_cast<int>(WiFi.RSSI(i)),
        enterprise ? "  enterprise" : ""
      );
    }
  }
  WiFi.scanDelete();
  if (!targetVisible) {
    Serial.printf("[wifi] WARNING: %s is not visible on 2.4 GHz, connection will fail\n", Secrets::WIFI_SSID);
    if (!similarSsid.isEmpty()) {
      Serial.printf("[wifi] SSID is case-sensitive, did you mean %s?\n", similarSsid.c_str());
    }
  }
}
