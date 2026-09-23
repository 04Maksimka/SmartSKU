#include "BoxApp.h"

#include <ArduinoJson.h>
#include <cmath>
#include <SPI.h>
#include <WiFi.h>

#include "AppConfig.h"
#include "BoxTopics.h"
#include "SecretsSeed.h"

BoxApp::BoxApp()
  : hardwareId_(readHardwareId()),
    mqtt_("box-" + hardwareId_),
    statusLed_(AppConfig::STATUS_LED_PIN),
    setupButton_(AppConfig::SETUP_BUTTON_PIN, AppConfig::SETUP_HOLD_MS),
    loadCellBus_(AppConfig::HX711_SCK),
    bleChannel_(AppConfig::BLE_NAME_PREFIX + hardwareId_.substring(hardwareId_.length() - 4)),
    setup_(hardwareId_, bleChannel_, wifi_, mqtt_, lockers_) {
  for (uint8_t id = 0; id < AppConfig::LOCKER_COUNT; ++id) {
    lockers_.push_back(std::make_unique<Locker>(id, AppConfig::LOCKERS[id], storage_, loadCellBus_));
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
  Serial.printf(
    "\n[app] SmartSKU box %s, hardware_id %s, %u locker(s)\n", AppConfig::FIRMWARE_VERSION, hardwareId_.c_str(), AppConfig::LOCKER_COUNT
  );
  statusLed_.begin();
  storage_.begin();
  console_.begin();
  setupButton_.begin();

  for (auto &locker : lockers_) {
    locker->deselectNfc();
  }
  NfcReader::hardResetAll(AppConfig::RFID_RST);
  SPI.begin(AppConfig::RFID_SCK, AppConfig::RFID_MISO, AppConfig::RFID_MOSI);
  for (auto &locker : lockers_) {
    locker->begin();
  }
  loadCellBus_.begin();
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
  loadNetworkSettings();
}

void BoxApp::loadNetworkSettings() {
  network_ = storage_.networkSettings();
  if (!network_.configured() && SecretsSeed::fill(network_)) {
    Serial.println("[app] network settings taken from secrets.h");
    storage_.saveNetworkSettings(network_);
  }
  if (!network_.configured()) {
    Serial.println("[app] no network settings: connect the box from the dashboard via Bluetooth");
    return;
  }
  wifi_.configure(network_);
  mqtt_.setServer(network_);
}

// Другая сеть или другой сервер: box_id мог быть выдан другим бэкендом, поэтому регистрируемся заново.
// Тот же бэкенд вернёт тот же box_id — регистрация по hardware_id идемпотентна
void BoxApp::applyNetworkSettings(const NetworkSettings &settings) {
  network_ = settings;
  storage_.saveNetworkSettings(network_);
  storage_.forgetBoxId();
  startProvisioning();
  wifi_.configure(network_);
  mqtt_.setServer(network_);
}

void BoxApp::update() {
  bool openSetup = setupButton_.update();
  if (openSetup) {
    Serial.println("[app] setup button held: setup mode");
  }
  if (openSetup || (!network_.configured() && !setup_.isOpen())) {
    // TLS-соединение освобождает память до того, как поднимется Bluetooth
    mqtt_.setPaused(network_.mqttTls);
    setup_.open();
  }
  setup_.update(network_, boxId_);
  NetworkSettings newSettings;
  if (setup_.takeSettings(newSettings)) {
    applyNetworkSettings(newSettings);
  }

  if (wasSetupOpen_ && !setup_.isOpen() && ESP.getFreeHeap() < AppConfig::MIN_FREE_HEAP_AFTER_SETUP) {
    Serial.printf("[app] free heap %u after setup mode is too low: rebooting\n", ESP.getFreeHeap());
    ESP.restart();
  }
  wasSetupOpen_ = setup_.isOpen();

  wifi_.update();
  mqtt_.setPaused(setup_.isOpen() && network_.mqttTls);
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

  loadCellBus_.update();
  for (auto &locker : lockers_) {
    locker->update();
  }
  pollNextNfc();
  handleConsole(console_.poll());

  unsigned long now = millis();
  if (boxId_.isEmpty() && mqtt_.connected() && (lastProvisionRequestMs_ == 0 || now - lastProvisionRequestMs_ >= AppConfig::PROVISION_RETRY_MS)) {
    lastProvisionRequestMs_ = now;
    requestBoxId();
  }
  if (online) {
    publishResults();
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

// Опрос считывателя без метки блокирует цикл до таймаута RC522, поэтому за цикл — не больше одного
void BoxApp::pollNextNfc() {
  unsigned long now = millis();
  if (lockers_.empty() || now - lastNfcPollMs_ < AppConfig::RFID_POLL_INTERVAL_MS) {
    return;
  }
  lastNfcPollMs_ = now;
  lockers_[nfcTurn_]->pollNfc();
  nfcTurn_ = (nfcTurn_ + 1) % lockers_.size();
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
  } else if (command == "scale") {
    String action = doc["action"] | "";
    Locker::ScaleAction scaleAction = Locker::parseScaleAction(action);
    if (scaleAction == Locker::ScaleAction::None) {
      Serial.printf("[app] ERROR: unknown scale action %s\n", action.c_str());
      return;
    }
    locker->startScale(scaleAction, doc["grams"] | AppConfig::REFERENCE_GRAMS);
  } else if (command == "cancel") {
    locker->cancelCalibration();
  } else if (command == "indicators") {
    String color = doc["led_color"] | "none";
    // screen_number: null — прочерки (ячейки нет, у неё нет тары или она не откалибрована)
    JsonVariant screenNumber = doc["screen_number"];
    if (!locker->applyIndicators(color, !screenNumber.isNull(), screenNumber | 0)) {
      Serial.printf("[app] unknown led_color %s\n", color.c_str());
    }
  } else {
    Serial.printf("[app] unknown command %s\n", command.c_str());
  }
}

// Бэкенд пишет итог в журнал и завершает заявку на калибровку, фронт по нему закрывает чек-лист
void BoxApp::publishResults() {
  for (auto &locker : lockers_) {
    JsonDocument doc;
    if (!locker->takeResult(doc.to<JsonObject>())) {
      continue;
    }
    doc["box_id"] = boxId_;
    String payload;
    serializeJson(doc, payload);
    mqtt_.publish(BoxTopics::events(boxId_), payload);
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
    case ConsoleCommand::Type::Zero:
      lockers_[command.lockerId]->startScale(Locker::ScaleAction::Zero, 0);
      break;
    case ConsoleCommand::Type::Reference:
      lockers_[command.lockerId]->startScale(Locker::ScaleAction::Reference, command.grams);
      break;
    case ConsoleCommand::Type::CellTare:
      lockers_[command.lockerId]->startScale(Locker::ScaleAction::CellTare, 0);
      break;
    case ConsoleCommand::Type::EraseTag:
      lockers_[command.lockerId]->eraseTag();
      break;
    case ConsoleCommand::Type::Cancel:
      lockers_[command.lockerId]->cancelCalibration();
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
    case ConsoleCommand::Type::Reset:
      Serial.println("[app] box_id and slot data erased, rebooting");
      storage_.resetKeepingNetwork();
      Serial.flush();
      ESP.restart();
      break;
    case ConsoleCommand::Type::Setup:
      if (setup_.isOpen()) {
        setup_.close();
      } else {
        mqtt_.setPaused(network_.mqttTls);
        setup_.open();
      }
      break;
    case ConsoleCommand::Type::Help:
    case ConsoleCommand::Type::Invalid:
      ServiceConsole::printHelp();
      break;
  }
}

void BoxApp::printStatus() {
  Serial.printf(
    "[app] hardware_id %s | box_id %s | wifi %s %s (%s, %d dBm) | mqtt %s:%u%s %s | setup %s\n", hardwareId_.c_str(),
    boxId_.isEmpty() ? "-" : boxId_.c_str(), network_.ssid.c_str(), wifi_.connected() ? "up" : "down", WiFi.localIP().toString().c_str(), WiFi.RSSI(),
    network_.mqttHost.c_str(), network_.mqttPort, network_.mqttTls ? " tls" : "", mqtt_.connected() ? "up" : "down", setup_.isOpen() ? "open" : "closed"
  );
  for (auto &locker : lockers_) {
    locker->printStatus();
  }
}

void BoxApp::updateStatusLed(bool online) {
  if (setup_.isOpen()) {
    statusLed_.setMode(StatusLed::Mode::Flash, AppConfig::STATUS_SETUP_PERIOD_MS, AppConfig::STATUS_SETUP_FLASH_MS);
  } else if (online) {
    statusLed_.setMode(StatusLed::Mode::On);
  } else if (mqtt_.connected()) {
    statusLed_.setMode(StatusLed::Mode::Blink, AppConfig::STATUS_BLINK_SLOW_MS);
  } else {
    statusLed_.setMode(StatusLed::Mode::Blink, AppConfig::STATUS_BLINK_FAST_MS);
  }
  statusLed_.update();
}
