#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

#include <atomic>

#include "NetworkSettings.h"

// Подключение к Wi-Fi (WPA2 Enterprise, пароль или открытая сеть) с переподключением и поиском сетей.
// Причину последнего обрыва запоминает, чтобы фронт показал «неверный пароль», а не просто «не подключилось»
class WifiConnection {
public:
  void begin();
  void update();
  bool connected() const;

  // Подключиться к другой сети; пустые настройки — отключиться и ждать
  void configure(const NetworkSettings &settings);
  bool attempting() const {
    return !settings_.ssid.isEmpty();
  }
  // Сколько длится текущая попытка подключения
  unsigned long attemptAgeMs() const;
  // Код причины из esp_wifi (WIFI_REASON_*), 0 — обрывов не было с начала попытки
  uint8_t lastDisconnectReason() const {
    return lastReason_.load();
  }
  static const char *describeReason(uint8_t reason);

  // Асинхронный поиск сетей: startScan(), затем в update() дождаться scanReady() и забрать результат
  void startScan();
  bool scanReady() const {
    return scanReady_;
  }
  void takeScanResults(JsonArray networks);

  // Энергосбережение Wi-Fi: пока включён Bluetooth, оно обязательно (иначе ESP-IDF падает)
  void setPowerSave(bool enabled);

private:
  void connect();
  static const char *authName(int authMode);

  NetworkSettings settings_;
  unsigned long attemptStartedMs_ = 0;
  bool wasConnected_ = false;
  bool scanning_ = false;
  bool scanReady_ = false;
  bool resumeAfterScan_ = false;
  std::atomic<uint8_t> lastReason_{0};
};
