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

bool BoxStorage::loadZero(uint8_t lockerId, double &zeroOffset) {
  String key = zeroKey(lockerId);
  if (!prefs_.isKey(key.c_str())) {
    return false;
  }
  zeroOffset = prefs_.getDouble(key.c_str(), 0);
  return true;
}

void BoxStorage::saveZero(uint8_t lockerId, double zeroOffset) {
  prefs_.putDouble(zeroKey(lockerId).c_str(), zeroOffset);
}

double BoxStorage::pieceWeight(const String &nfcId) {
  return prefs_.getDouble(pieceWeightKey(nfcId).c_str(), 0);
}

void BoxStorage::savePieceWeight(const String &nfcId, double pieceWeight) {
  prefs_.putDouble(pieceWeightKey(nfcId).c_str(), pieceWeight);
}

String BoxStorage::zeroKey(uint8_t lockerId) {
  return "zero" + String(lockerId);
}

String BoxStorage::pieceWeightKey(const String &nfcId) {
  // FNV-1a, 32 бита
  uint32_t hash = 2166136261u;
  for (size_t i = 0; i < nfcId.length(); ++i) {
    hash ^= static_cast<uint8_t>(nfcId[i]);
    hash *= 16777619u;
  }
  char key[12];
  snprintf(key, sizeof(key), "pw%08lx", static_cast<unsigned long>(hash));
  return String(key);
}
