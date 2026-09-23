#include "BoxStorage.h"

#include "AppConfig.h"

void BoxStorage::begin() {
  if (!prefs_.begin(AppConfig::STORAGE_NAMESPACE, false)) {
    Serial.println("[storage] ERROR: NVS is not available, settings will not survive reboot");
  }
}

NetworkSettings BoxStorage::networkSettings() {
  NetworkSettings settings;
  settings.ssid = prefs_.getString("wifi_ssid", "");
  settings.username = prefs_.getString("wifi_user", "");
  settings.password = prefs_.getString("wifi_pass", "");
  settings.mqttHost = prefs_.getString("mqtt_host", "");
  settings.mqttPort = prefs_.getUShort("mqtt_port", 0);
  return settings;
}

void BoxStorage::saveNetworkSettings(const NetworkSettings &settings) {
  prefs_.putString("wifi_ssid", settings.ssid);
  prefs_.putString("wifi_user", settings.username);
  prefs_.putString("wifi_pass", settings.password);
  prefs_.putString("mqtt_host", settings.mqttHost);
  prefs_.putUShort("mqtt_port", settings.mqttPort);
}

String BoxStorage::boxId() {
  return prefs_.getString("box_id", "");
}

void BoxStorage::saveBoxId(const String &boxId) {
  prefs_.putString("box_id", boxId);
}

void BoxStorage::forgetBoxId() {
  prefs_.remove("box_id");
}

void BoxStorage::resetKeepingNetwork() {
  NetworkSettings settings = networkSettings();
  prefs_.clear();
  saveNetworkSettings(settings);
}

bool BoxStorage::loadZero(uint8_t lockerId, double &raw) {
  String name = key("zero", lockerId);
  if (!prefs_.isKey(name.c_str())) {
    return false;
  }
  raw = prefs_.getDouble(name.c_str(), 0);
  return true;
}

void BoxStorage::saveZero(uint8_t lockerId, double raw) {
  prefs_.putDouble(key("zero", lockerId).c_str(), raw);
}

double BoxStorage::countsPerGram(uint8_t lockerId) {
  return prefs_.getDouble(key("scale", lockerId).c_str(), 0);
}

void BoxStorage::saveCountsPerGram(uint8_t lockerId, double countsPerGram) {
  prefs_.putDouble(key("scale", lockerId).c_str(), countsPerGram);
}

String BoxStorage::key(const char *prefix, uint8_t lockerId) {
  return String(prefix) + String(lockerId);
}
