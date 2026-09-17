#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

#include "AppConfig.h"
#include "BoxStorage.h"
#include "CountDisplay.h"
#include "IndicatorLed.h"
#include "LoadCell.h"
#include "LoadCellBus.h"
#include "NfcReader.h"

// Умная ячейка: тензодатчик + NFC + дисплей + светодиод.
// Логика та же, что у VirtualBox в эмуляторе: вес без ячейки = 0, вес штуки хранится по NFC-метке,
// после команды calibration вес штуки считается при следующей вставке ячейки.
// Вес — в условных единицах (сырые отсчёты HX711 минус ноль), см. AppConfig
class Locker {
public:
  Locker(uint8_t lockerId, const LockerHardware &hardware, BoxStorage &storage, LoadCellBus &loadCellBus);

  // До SPI.begin() и до begin() любой ячейки
  void deselectNfc();
  void begin();
  // Каждый цикл, после LoadCellBus::update()
  void update();
  // Один опрос NFC; считыватели опрашиваются по очереди, расписание — в BoxApp
  void pollNfc();

  uint8_t id() const {
    return id_;
  }
  // UID вставленной ячейки или пустая строка
  String cellUid() const {
    return nfc_.present() ? nfc_.uid() : String();
  }
  // Вес измерен и не «плывёт» после вставки, ноль сейчас не устанавливается; иначе ячейку не стоит отправлять
  // в телеметрию. Слот без нуля отправляется с zeroed=false и нулевым весом, чтобы фронт предупредил о нём
  bool ready() const {
    return tareWindowsLeft_ == 0 && windowReady_ && settled_;
  }
  void fillReading(JsonObject reading) const;
  // Что из железа ячейки отвечает — для фронта при подключении бокса
  void fillHardwareInfo(JsonObject info) const;
  void printStatus();

  // Команды бэкенда
  void startCalibration(int numOfPieces);
  bool applyIndicators(const String &ledColor, int screenNumber);
  // Нет связи с бэкендом — дисплей показывает количество, посчитанное самим боксом
  void setBackendOnline(bool online);

  enum class TareStart { Started, NoCell, LoadCellFailed };
  // Ноль по вставленной пустой ячейке: копится несколько окон, результат — takeTareDone()
  TareStart requestTare();
  // true один раз после сохранения нового нуля; zero — сырые показания с пустой ячейкой
  bool takeTareDone(double &zero);

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
  const LockerHardware hardware_;
  const bool invertLoad_;
  BoxStorage &storage_;
  LoadCellBus &loadCellBus_;
  LoadCell loadCell_;
  NfcReader nfc_;
  CountDisplay display_;
  IndicatorLed led_;

  bool hasZero_ = false;
  double zeroOffset_ = 0;
  // Сколько окон ещё копить для нуля; 0 — обнуление не идёт
  uint8_t tareWindowsLeft_ = 0;
  double tareSum_ = 0;
  bool tareDone_ = false;
  bool windowReady_ = false;
  bool loadCellFailureLogged_ = false;
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
