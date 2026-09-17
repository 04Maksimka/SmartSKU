#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

#include <memory>
#include <vector>

#include "BleSetupChannel.h"
#include "Locker.h"
#include "MqttLink.h"
#include "NetworkSettings.h"
#include "WifiConnection.h"

// Режим подключения бокса с фронта по Bluetooth. Протокол (JSON-строки, README → «Подключение бокса»):
//   фронт → бокс: {"op":"info"} | {"op":"scan"} | {"op":"connect","ssid","username","password","host","port"}
//   бокс → фронт: {"type":"info",...} | {"type":"networks","items":[...]} | {"type":"status","state":...}
//                 | {"type":"error","message":...}
// Новые настройки BoxApp забирает через takeSettings() и сам применяет их
class SetupController {
public:
  SetupController(
    const String &hardwareId, BleSetupChannel &channel, WifiConnection &wifi, MqttLink &mqtt,
    const std::vector<std::unique_ptr<Locker>> &lockers
  );

  void open();
  void close();
  bool isOpen() const {
    return channel_.isOpen();
  }

  // current — действующие настройки, boxId — пустой, пока бэкенд не выдал id
  void update(const NetworkSettings &current, const String &boxId);
  bool takeSettings(NetworkSettings &settings);

private:
  void handleRequest(const String &line, const NetworkSettings &current, const String &boxId);
  void handleConnect(JsonDocument &request);
  void sendInfo(const NetworkSettings &current, const String &boxId);
  void sendNetworks();
  void reportProgress(const String &boxId);
  void sendError(const String &message);
  void send(JsonDocument &doc);

  const String hardwareId_;
  BleSetupChannel &channel_;
  WifiConnection &wifi_;
  MqttLink &mqtt_;
  const std::vector<std::unique_ptr<Locker>> &lockers_;

  unsigned long lastActivityMs_ = 0;
  bool scanRequested_ = false;
  bool hasSettings_ = false;
  NetworkSettings settings_;
  // После команды connect бокс сообщает, как идёт подключение; registeredAtMs_ — когда всё получилось
  bool tracking_ = false;
  String lastProgress_;
  unsigned long registeredAtMs_ = 0;
};
