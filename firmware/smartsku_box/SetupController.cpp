#include "SetupController.h"

#include <WiFi.h>

#include "AppConfig.h"

SetupController::SetupController(
  const String &hardwareId, BleSetupChannel &channel, WifiConnection &wifi, MqttLink &mqtt,
  const std::vector<std::unique_ptr<Locker>> &lockers
)
  : hardwareId_(hardwareId), channel_(channel), wifi_(wifi), mqtt_(mqtt), lockers_(lockers) {}

void SetupController::open() {
  if (channel_.isOpen()) {
    lastActivityMs_ = millis();
    return;
  }
  wifi_.setPowerSave(true);
  channel_.open();
  lastActivityMs_ = millis();
  tracking_ = false;
  registeredAtMs_ = 0;
}

void SetupController::close() {
  if (!channel_.isOpen()) {
    return;
  }
  channel_.close();
  wifi_.setPowerSave(false);
  scanRequested_ = false;
  tracking_ = false;
}

void SetupController::update(const NetworkSettings &current, const String &boxId) {
  if (!channel_.isOpen()) {
    return;
  }
  unsigned long now = millis();
  if (channel_.takeConnectedEvent()) {
    lastActivityMs_ = now;
    Serial.println("[ble] client connected");
  }

  String line;
  while (channel_.pollRequest(line)) {
    lastActivityMs_ = now;
    handleRequest(line, current, boxId);
  }
  if (scanRequested_ && wifi_.scanReady()) {
    scanRequested_ = false;
    sendNetworks();
  }
  if (tracking_) {
    reportProgress(boxId);
  }

  if (registeredAtMs_ != 0 && now - registeredAtMs_ >= AppConfig::SETUP_LINGER_MS) {
    close();
  } else if (now - lastActivityMs_ >= AppConfig::SETUP_WINDOW_MS) {
    Serial.println("[ble] setup window expired");
    close();
  }
}

bool SetupController::takeSettings(NetworkSettings &settings) {
  if (!hasSettings_) {
    return false;
  }
  settings = settings_;
  hasSettings_ = false;
  return true;
}

void SetupController::handleRequest(const String &line, const NetworkSettings &current, const String &boxId) {
  JsonDocument request;
  if (deserializeJson(request, line)) {
    sendError("request is not JSON");
    return;
  }
  String op = request["op"] | "";
  Serial.printf("[ble] request %s\n", op.c_str());
  if (op == "info") {
    sendInfo(current, boxId);
  } else if (op == "scan") {
    scanRequested_ = true;
    wifi_.startScan();
  } else if (op == "connect") {
    handleConnect(request);
  } else {
    sendError("unknown op " + op);
  }
}

void SetupController::handleConnect(JsonDocument &request) {
  NetworkSettings settings;
  settings.ssid = request["ssid"] | "";
  settings.username = request["username"] | "";
  settings.password = request["password"] | "";
  settings.mqttHost = request["host"] | "";
  settings.mqttPort = request["port"] | AppConfig::DEFAULT_MQTT_PORT;
  settings.ssid.trim();
  settings.username.trim();
  settings.mqttHost.trim();
  if (!settings.configured()) {
    sendError("ssid, host and port are required");
    return;
  }
  settings_ = settings;
  hasSettings_ = true;
  tracking_ = true;
  lastProgress_ = "";
  registeredAtMs_ = 0;
  Serial.printf("[ble] new settings: wifi %s, server %s:%u\n", settings.ssid.c_str(), settings.mqttHost.c_str(), settings.mqttPort);
}

// Состояния по порядку: wifi_connecting → server_connecting → registering → registered;
// wifi_failed и server_failed — подключение продолжает повторяться, фронт может прислать другие настройки
void SetupController::reportProgress(const String &boxId) {
  if (hasSettings_) {
    return;
  }
  JsonDocument doc;
  doc["type"] = "status";
  String state;
  if (!wifi_.connected()) {
    uint8_t reason = wifi_.lastDisconnectReason();
    state = reason != 0 ? "wifi_failed" : "wifi_connecting";
    if (reason != 0) {
      doc["reason"] = reason;
      doc["message"] = WifiConnection::describeReason(reason);
    }
  } else if (!boxId.isEmpty()) {
    // box_id выдан — регистрация состоялась, даже если бокс сейчас переподключается к брокеру под новым id
    state = "registered";
    doc["box_id"] = boxId;
  } else if (!mqtt_.connected()) {
    state = mqtt_.failedAttempts() >= 2 ? "server_failed" : "server_connecting";
    doc["ip"] = WiFi.localIP().toString();
    doc["host"] = mqtt_.host();
    if (mqtt_.lastError() != 0) {
      doc["error"] = mqtt_.lastError();
    }
  } else {
    state = "registering";
  }
  doc["state"] = state;

  String key;
  serializeJson(doc, key);
  if (key == lastProgress_) {
    return;
  }
  lastProgress_ = key;
  channel_.send(key);
  if (state == "registered" && registeredAtMs_ == 0) {
    registeredAtMs_ = millis();
    tracking_ = false;
  }
}

void SetupController::sendInfo(const NetworkSettings &current, const String &boxId) {
  JsonDocument doc;
  doc["type"] = "info";
  doc["hardware_id"] = hardwareId_;
  doc["firmware"] = AppConfig::FIRMWARE_VERSION;
  doc["box_id"] = boxId;
  JsonObject wifi = doc["wifi"].to<JsonObject>();
  wifi["ssid"] = current.ssid;
  wifi["username"] = current.username;
  wifi["connected"] = wifi_.connected();
  if (wifi_.connected()) {
    wifi["ip"] = WiFi.localIP().toString();
    wifi["rssi"] = WiFi.RSSI();
  }
  JsonObject server = doc["server"].to<JsonObject>();
  server["host"] = current.mqttHost;
  server["port"] = current.mqttPort;
  server["connected"] = mqtt_.connected();
  JsonArray lockers = doc["lockers"].to<JsonArray>();
  for (const auto &locker : lockers_) {
    locker->fillHardwareInfo(lockers.add<JsonObject>());
  }
  send(doc);
}

void SetupController::sendNetworks() {
  JsonDocument doc;
  doc["type"] = "networks";
  wifi_.takeScanResults(doc["items"].to<JsonArray>());
  send(doc);
}

void SetupController::sendError(const String &message) {
  JsonDocument doc;
  doc["type"] = "error";
  doc["message"] = message;
  send(doc);
}

void SetupController::send(JsonDocument &doc) {
  String line;
  serializeJson(doc, line);
  channel_.send(line);
}
