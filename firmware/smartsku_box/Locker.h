#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

#include "AppConfig.h"
#include "BoxStorage.h"
#include "CountDisplay.h"
#include "IndicatorLed.h"
#include "LoadCell.h"
#include "NfcReader.h"

// Умная ячейка: тензодатчик + NFC + дисплей + светодиод.
// Логика та же, что у VirtualBox в эмуляторе: вес без ячейки = 0, вес штуки хранится по NFC-метке,
// после команды calibration вес штуки считается при следующей вставке ячейки.
// Вес — в условных единицах (сырые отсчёты HX711 минус ноль), см. AppConfig
class Locker {
public:
  Locker(uint8_t lockerId, const LockerHardware &hardware, BoxStorage &storage);

  void begin();
  void update();

  uint8_t id() const {
    return id_;
  }
  // Ноль выставлен, вес измерен и не «плывёт» после вставки; иначе ячейку не стоит отправлять в телеметрию
  bool ready() const {
    return hasZero_ && tareWindowsLeft_ == 0 && windowReady_ && settled_;
  }
  void fillReading(JsonObject reading) const;
  void printStatus() const;

  // Команды бэкенда
  void startCalibration(int numOfPieces);
  bool applyIndicators(const String &ledColor, int screenNumber);
  // Нет связи с бэкендом — дисплей показывает количество, посчитанное самим боксом
  void setBackendOnline(bool online);

  // Ноль по вставленной пустой ячейке; false, если ячейки или датчика нет.
  bool requestTare();

private:
  void onWindow();
  void applyTare();
  void onCellChanged();
  void trackSettling();
  void trackCalibration();
  void updateReportedWeight();
  void refreshDisplay();
  // Сырые показания минус ноль, со знаком; при invertLoad знак развёрнут, чтобы нагрузка давала плюс
  double net() const;
  // Нагрузка по последнему окну, не меньше 0; 0 без ячейки или без нуля
  double measuredWeight() const;
  int pieces() const;

  const uint8_t id_;
  const bool invertLoad_;
  BoxStorage &storage_;
  LoadCell loadCell_;
  NfcReader nfc_;
  CountDisplay display_;
  IndicatorLed led_;

  bool hasZero_ = false;
  double zeroOffset_ = 0;
  // Сколько окон ещё копить для нуля; 0 — обнуление не идёт
  uint8_t tareWindowsLeft_ = 0;
  double tareSum_ = 0;
  bool windowReady_ = false;
  // Вес, который уходит в box_data и на дисплей: меняется, только когда сдвиг больше шума (гистерезис)
  double reportedWeight_ = 0;
  double pieceWeight_ = 0;

  bool settled_ = true;
  unsigned long insertedAtMs_ = 0;
  uint8_t stableWindows_ = 0;
  double previousWeight_ = 0;

  // Калибровка штуки: 0 — не ждём
  int pendingPieces_ = 0;
  bool cellWasRemoved_ = false;
  bool emptyWarned_ = false;

  bool backendOnline_ = false;
  bool hasScreenNumber_ = false;
  int screenNumber_ = 0;
};
