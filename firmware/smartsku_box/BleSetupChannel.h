#pragma once

#include <Arduino.h>

#include <atomic>
#include <deque>

#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

class BLECharacteristic;
class BLEDescriptor;
class BLEServer;
class BLEService;

// Канал настройки по Bluetooth LE. Как UART: фронт пишет JSON-строки в RX, бокс отвечает JSON-строками через
// уведомления TX. Строки заканчиваются '\n' и режутся на куски под MTU — так пролезают и длинные списки сетей.
// Колбэки стека Bluetooth работают в своей задаче, поэтому запросы копятся в очереди под мьютексом, а читаются
// из loop(). Bluetooth включается только на время настройки: ему нужен modem sleep Wi-Fi, а тот мешает HX711
class BleSetupChannel {
public:
  explicit BleSetupChannel(const String &deviceName);

  void open();
  void close();
  bool isOpen() const {
    return open_;
  }
  bool clientConnected() const {
    return clientConnected_.load();
  }
  // true один раз после каждого нового подключения
  bool takeConnectedEvent();

  bool pollRequest(String &line);
  void send(const String &line);

  // Вызываются из колбэков стека Bluetooth
  void onClientConnected();
  void onClientDisconnected();
  void onData(const String &chunk);

private:
  void initStack();
  void releaseGattObjects();

  const String deviceName_;
  bool initialized_ = false;
  bool open_ = false;
  BLEServer *server_ = nullptr;
  // Сервис, характеристики и дескриптор создаются на каждое открытие, а BLEDevice::deinit() удаляет только сервер:
  // без ручного удаления каждый цикл открыть/закрыть терял ~2.9 КБ — и в облаке TLS переставал помещаться
  BLEService *service_ = nullptr;
  BLECharacteristic *rx_ = nullptr;
  BLECharacteristic *tx_ = nullptr;
  BLEDescriptor *txCccd_ = nullptr;

  SemaphoreHandle_t mutex_;
  String partial_;
  std::deque<String> requests_;
  std::atomic<bool> clientConnected_{false};
  std::atomic<bool> connectedEvent_{false};
};
