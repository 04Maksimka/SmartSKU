#pragma once

#include <Arduino.h>

#include <memory>
#include <vector>

#include "BleSetupChannel.h"
#include "BoxStorage.h"
#include "HoldButton.h"
#include "LoadCellBus.h"
#include "Locker.h"
#include "MqttLink.h"
#include "NetworkSettings.h"
#include "ServiceConsole.h"
#include "SetupController.h"
#include "StatusLed.h"
#include "WifiConnection.h"

// Прошивка бокса по MQTT-протоколу из README:
// 0) нет настроек сети — ждёт их по Bluetooth (режим подключения, его же включает удержание кнопки подключения);
// 1) нет box_id в памяти — запрашивает его у бэкенда (provisioning) по hardware_id;
// 2) дальше шлёт box_data каждые TELEMETRY_INTERVAL_MS и выполняет команды scale / calibration / cancel / indicators;
//    итоги настройки весов и калибровки уходят в топик events.
// Светодиод платы: вспышка раз в секунду — режим подключения, часто мигает — нет связи, редко — ждём box_id,
// горит — работаем
class BoxApp {
public:
  BoxApp();

  void begin();
  void update();

private:
  static String readHardwareId();

  void loadNetworkSettings();
  void applyNetworkSettings(const NetworkSettings &settings);
  void handleMessage(const String &topic, const String &payload);
  void handleProvisionResponse(const String &payload);
  void handleCommand(const String &payload);
  void handleConsole(const ConsoleCommand &command);
  Locker *findLocker(int lockerId);

  void startProvisioning();
  void startRunning(const String &boxId);
  void requestBoxId();
  void publishTelemetry();
  void publishResults();
  void printStatus();
  void updateStatusLed(bool online);
  void pollNextNfc();

  const String hardwareId_;
  BoxStorage storage_;
  WifiConnection wifi_;
  MqttLink mqtt_;
  StatusLed statusLed_;
  ServiceConsole console_;
  HoldButton setupButton_;
  LoadCellBus loadCellBus_;
  std::vector<std::unique_ptr<Locker>> lockers_;
  BleSetupChannel bleChannel_;
  SetupController setup_;
  NetworkSettings network_;

  String boxId_;
  // box_id из ответа бэкенда; сессия переключается в update(), а не внутри колбэка MQTT
  String receivedBoxId_;
  bool wasSetupOpen_ = false;
  bool wasOnline_ = false;
  unsigned long lastProvisionRequestMs_ = 0;
  unsigned long lastTelemetryMs_ = 0;
  unsigned long lastDebugLogMs_ = 0;
  // Чей считыватель опрашивать следующим
  size_t nfcTurn_ = 0;
  unsigned long lastNfcPollMs_ = 0;
  bool verbose_ = true;
};
