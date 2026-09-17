#pragma once

#include "AppConfig.h"
#include "NetworkSettings.h"

#if __has_include("secrets.h")
#include "secrets.h"
#define SMARTSKU_HAS_SECRETS 1
#else
#define SMARTSKU_HAS_SECRETS 0
#endif

// Необязательный secrets.h — только для разработки: если в NVS ещё нет настроек сети, они берутся оттуда.
// Без него бокс при первом включении сразу ждёт настройки по Bluetooth
class SecretsSeed {
public:
  static bool fill(NetworkSettings &settings) {
#if SMARTSKU_HAS_SECRETS
    settings.ssid = Secrets::WIFI_SSID;
    settings.username = Secrets::EAP_USERNAME;
    settings.password = Secrets::WIFI_PASSWORD;
    settings.mqttHost = Secrets::MQTT_HOST;
    settings.mqttPort = AppConfig::DEFAULT_MQTT_PORT;
    return settings.configured();
#else
    (void)settings;
    return false;
#endif
  }
};
