#pragma once

#include <Arduino.h>

#include "AppConfig.h"

// Топики MQTT — те же, что в backend/messaging/topics.py (таблица в README)
class BoxTopics {
public:
  static String provisionRequest() {
    return prefix() + "/provision/request";
  }
  static String provisionResponse(const String &hardwareId) {
    return prefix() + "/provision/response/" + hardwareId;
  }
  static String data(const String &boxId) {
    return box(boxId) + "/data";
  }
  static String status(const String &boxId) {
    return box(boxId) + "/status";
  }
  static String commands(const String &boxId) {
    return box(boxId) + "/commands";
  }

private:
  static String prefix() {
    return String(AppConfig::TOPIC_PREFIX);
  }
  static String box(const String &boxId) {
    return prefix() + "/boxes/" + boxId;
  }
};
