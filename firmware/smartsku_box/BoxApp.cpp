#include "BoxApp.h"

#include <ArduinoJson.h>
#include <SPI.h>
#include <WiFi.h>

#include "AppConfig.h"
#include "BoxTopics.h"

BoxApp::BoxApp()
  : hardwareId_(readHardwareId()), mqtt_("box-" + hardwareId_), statusLed_(AppConfig::STATUS_LED_PIN) {
  for (uint8_t id = 0; id < AppConfig::LOCKER_COUNT; ++id) {
    lockers_.push_back(std::make_unique<Locker>(id, AppConfig::LOCKERS[id], storage_));
  }
}

// Уникальный id платы из заводского MAC-адреса
String BoxApp::readHardwareId() {
  char buffer[13];
  snprintf(buffer, sizeof(buffer), "%012llX", ESP.getEfuseMac());
  return String(buffer);
}

void BoxApp::begin() {
  Serial.begin(AppConfig::SERIAL_BAUD);
  Serial.printf("\n[app] SmartSKU box, hardware_id %s, %u locker(s)\n", hardwareId_.c_str(), AppConfig::LOCKER_COUNT);
  statusLed_.begin();
  storage_.begin();
  console_.begin();

  SPI.begin(AppConfig::RFID_SCK, AppConfig::RFID_MISO, AppConfig::RFID_MOSI);
  for (auto &locker : lockers_) {
    locker->begin();
  }
  ServiceConsole::printHelp();

  mqtt_.begin([this](const String &topic, const String &payload) {
    handleMessage(topic, payload);
  });
  String savedBoxId = storage_.boxId();
  if (savedBoxId.isEmpty()) {
    startProvisioning();
  } else {
    startRunning(savedBoxId);
  }
  wifi_.begin();
}

void BoxApp::update() {
  wifi_.update();
  mqtt_.update(wifi_.connected());

  if (!receivedBoxId_.isEmpty()) {
    storage_.saveBoxId(receivedBoxId_);
    startRunning(receivedBoxId_);
    receivedBoxId_ = "";
  }

  bool online = mqtt_.connected() && !boxId_.isEmpty();
  if (online != wasOnline_) {
    wasOnline_ = online;
    for (auto &locker : lockers_) {
      locker->setBackendOnline(online);
    }
  }

  for (auto &locker : lockers_) {
    locker->update();
  }
  handleConsole(console_.poll());

  unsigned long now = millis();
  if (boxId_.isEmpty() && mqtt_.connected() && (lastProvisionRequestMs_ == 0 || now - lastProvisionRequestMs_ >= AppConfig::PROVISION_RETRY_MS)) {
    lastProvisionRequestMs_ = now;
    requestBoxId();
  }
  if (online && now - lastTelemetryMs_ >= AppConfig::TELEMETRY_INTERVAL_MS) {
    lastTelemetryMs_ = now;
    publishTelemetry();
  }
  if (verbose_ && now - lastDebugLogMs_ >= AppConfig::DEBUG_LOG_INTERVAL_MS) {
    lastDebugLogMs_ = now;
    for (auto &locker : lockers_) {
      locker->printStatus();
    }
  }
  updateStatusLed(online);
}

void BoxApp::startProvisioning() {
  boxId_ = "";
  lastProvisionRequestMs_ = 0;
  Serial.println("[app] no box_id yet, asking the backend");
  mqtt_.configureSession("", {BoxTopics::provisionResponse(hardwareId_)});
}

void BoxApp::startRunning(const String &boxId) {
  boxId_ = boxId;
  Serial.printf("[app] running as box %s\n", boxId_.c_str());
  mqtt_.configureSession(BoxTopics::status(boxId_), {BoxTopics::commands(boxId_)});
}

void BoxApp::requestBoxId() {
  JsonDocument doc;
  doc["hardware_id"] = hardwareId_;
  String payload;
  serializeJson(doc, payload);
  Serial.println("[app] provision request sent");
  mqtt_.publish(BoxTopics::provisionRequest(), payload);
}

void BoxApp::publishTelemetry() {
  JsonDocument doc;
  doc["box_id"] = boxId_;
  JsonArray readings = doc["lockers"].to<JsonArray>();
  for (auto &locker : lockers_) {
    // Бэкенд обрабатывает ячейки по отдельности, поэтому ячейку с неустановившимся весом просто пропускаем:
    // иначе он принял бы случайный вес за изменение количества
    if (locker->ready()) {
      locker->fillReading(readings.add<JsonObject>());
    }
  }
  if (readings.size() == 0) {
    return;
  }
  String payload;
  serializeJson(doc, payload);
  if (!mqtt_.publish(BoxTopics::data(boxId_), payload)) {
    Serial.println("[app] ERROR: telemetry publish failed");
  }
}

void BoxApp::handleMessage(const String &topic, const String &payload) {
  Serial.printf("[mqtt] %s <- %s\n", topic.c_str(), payload.c_str());
  if (boxId_.isEmpty() && topic == BoxTopics::provisionResponse(hardwareId_)) {
    handleProvisionResponse(payload);
  } else if (!boxId_.isEmpty() && topic == BoxTopics::commands(boxId_)) {
    handleCommand(payload);
  }
}

void BoxApp::handleProvisionResponse(const String &payload) {
  JsonDocument doc;
  if (deserializeJson(doc, payload)) {
    Serial.println("[app] ERROR: provision response is not JSON");
    return;
  }
  String boxId = doc["box_id"] | "";
  if (doc["hardware_id"] != hardwareId_ || boxId.isEmpty()) {
    Serial.println("[app] ERROR: provision response is not for this box");
    return;
  }
  Serial.printf("[app] backend assigned box_id %s\n", boxId.c_str());
  receivedBoxId_ = boxId;
}

void BoxApp::handleCommand(const String &payload) {
  JsonDocument doc;
  if (deserializeJson(doc, payload)) {
    Serial.println("[app] ERROR: command is not JSON");
    return;
  }
  if (doc["box_id"] != boxId_) {
    Serial.println("[app] ERROR: command for another box ignored");
    return;
  }
  Locker *locker = findLocker(doc["locker_id"] | -1);
  if (locker == nullptr) {
    Serial.println("[app] ERROR: command for unknown locker ignored");
    return;
  }

  String command = doc["command"] | "";
  if (command == "calibration") {
    int pieces = doc["num_of_pieces"] | 0;
    if (pieces <= 0) {
      Serial.println("[app] ERROR: num_of_pieces must be positive");
      return;
    }
    locker->startCalibration(pieces);
  } else if (command == "tare") {
    locker->requestTare();
  } else if (command == "indicators") {
    String color = doc["led_color"] | "none";
    if (!locker->applyIndicators(color, doc["screen_number"] | 0)) {
      Serial.printf("[app] unknown led_color %s\n", color.c_str());
    }
  } else {
    Serial.printf("[app] unknown command %s\n", command.c_str());
  }
}

Locker *BoxApp::findLocker(int lockerId) {
  if (lockerId < 0 || lockerId >= static_cast<int>(lockers_.size())) {
    return nullptr;
  }
  return lockers_[lockerId].get();
}

void BoxApp::handleConsole(const ConsoleCommand &command) {
  switch (command.type) {
    case ConsoleCommand::Type::None:
      break;
    case ConsoleCommand::Type::Tare:
      lockers_[command.lockerId]->requestTare();
      break;
    case ConsoleCommand::Type::Status:
      printStatus();
      break;
    case ConsoleCommand::Type::Verbose:
      verbose_ = !verbose_;
      Serial.printf("[app] readings log %s\n", verbose_ ? "on" : "off");
      break;
    case ConsoleCommand::Type::ForgetBoxId:
      Serial.println("[app] box_id forgotten, rebooting");
      storage_.forgetBoxId();
      Serial.flush();
      ESP.restart();
      break;
    case ConsoleCommand::Type::Help:
    case ConsoleCommand::Type::Invalid:
      ServiceConsole::printHelp();
      break;
  }
}

void BoxApp::printStatus() {
  Serial.printf(
    "[app] hardware_id %s | box_id %s | wifi %s (%s, %d dBm) | mqtt %s\n", hardwareId_.c_str(), boxId_.isEmpty() ? "-" : boxId_.c_str(),
    wifi_.connected() ? "up" : "down", WiFi.localIP().toString().c_str(), WiFi.RSSI(), mqtt_.connected() ? "up" : "down"
  );
  for (auto &locker : lockers_) {
    locker->printStatus();
  }
}

void BoxApp::updateStatusLed(bool online) {
  if (online) {
    statusLed_.setMode(StatusLed::Mode::On);
  } else if (mqtt_.connected()) {
    statusLed_.setMode(StatusLed::Mode::Blink, AppConfig::STATUS_BLINK_SLOW_MS);
  } else {
    statusLed_.setMode(StatusLed::Mode::Blink, AppConfig::STATUS_BLINK_FAST_MS);
  }
  statusLed_.update();
}
