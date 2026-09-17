#pragma once

#include <Arduino.h>

// Куда подключаться: Wi-Fi и MQTT-брокер. Хранится в NVS и задаётся с фронта по Bluetooth, поэтому одна и та же
// прошивка работает с любой сетью и любым сервером
struct NetworkSettings {
  String ssid;
  // Непустой логин — WPA2 Enterprise (PEAP), пустой — обычная сеть с паролем или открытая
  String username;
  String password;
  // IP или имя компьютера с брокером; имя вида host.local ищется через mDNS
  String mqttHost;
  uint16_t mqttPort = 0;

  bool configured() const {
    return !ssid.isEmpty() && !mqttHost.isEmpty() && mqttPort > 0;
  }
  bool enterprise() const {
    return !username.isEmpty();
  }
};
