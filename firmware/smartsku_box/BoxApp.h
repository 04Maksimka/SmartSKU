#pragma once

#include <Arduino.h>

#include <memory>
#include <vector>

#include "BoxStorage.h"
#include "Locker.h"
#include "MqttLink.h"
#include "ServiceConsole.h"
#include "StatusLed.h"
#include "WifiConnection.h"

// Прошивка бокса по MQTT-протоколу из README:
// 1) нет box_id в памяти — запрашивает его у бэкенда (provisioning) по hardware_id;
// 2) дальше шлёт box_data каждые TELEMETRY_INTERVAL_MS и выполняет команды calibration / indicators.
// Светодиод платы: часто мигает — нет связи, редко — ждём box_id, горит — работаем
class BoxApp {
public:
  BoxApp();

  void begin();
  void update();

private:
  static String readHardwareId();

  void handleMessage(const String &topic, const String &payload);
  void handleProvisionResponse(const String &payload);
  void handleCommand(const String &payload);
  void handleConsole(const ConsoleCommand &command);
  Locker *findLocker(int lockerId);

  void startProvisioning();
  void startRunning(const String &boxId);
  void requestBoxId();
  void publishTelemetry();
  void printStatus();
  void updateStatusLed(bool online);

  const String hardwareId_;
  BoxStorage storage_;
  WifiConnection wifi_;
  MqttLink mqtt_;
  StatusLed statusLed_;
  ServiceConsole console_;
  std::vector<std::unique_ptr<Locker>> lockers_;

  String boxId_;
  // box_id из ответа бэкенда; сессия переключается в update(), а не внутри колбэка MQTT
  String receivedBoxId_;
  bool wasOnline_ = false;
  unsigned long lastProvisionRequestMs_ = 0;
  unsigned long lastTelemetryMs_ = 0;
  unsigned long lastDebugLogMs_ = 0;
  bool verbose_ = true;
};
