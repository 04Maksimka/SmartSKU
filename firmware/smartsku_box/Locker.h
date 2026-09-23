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
// Слот (тензодатчик в корпусе) знает свой ноль и масштаб — отсчётов HX711 на грамм, знак масштаба — направление
// датчика. Их задаёт настройка весов эталонной гирей, хранятся в NVS. Ячейка (NFC-метка) хранит свою тару и вес штуки
// в граммах, поэтому её можно переставить в любой слот любого бокса:
//   вес содержимого, г = (показание - ноль) / масштаб - тара
//
// Настройка весов — разовые команды, каждая — один замер по устоявшемуся весу:
//   zero      — слот без ячейки, на площадке пусто: ноль;
//   reference — на пустой площадке эталонная гиря: масштаб (ноль должен быть свежим);
//   cell_tare — вставлена пустая ячейка: её вес пишется в метку.
// Калибровка — сценарий, который бокс ведёт сам по NFC и весу: remove_cell → insert_filled → measure_pieces.
// Итоги уходят разовым событием (takeResult): scale_done / scale_failed / calibration_done / calibration_failed
class Locker {
public:
  enum class ScaleAction { None, Zero, Reference, CellTare };

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
  // Вес измерен и не «плывёт» после вставки; иначе ячейку не стоит отправлять в телеметрию.
  // Во время калибровки ячейка отправляется всегда, чтобы фронт видел текущий шаг
  bool ready() const {
    return windowReady_ && (settled_ || step_ != Step::None);
  }
  void fillReading(JsonObject reading) const;
  // Что из железа ячейки отвечает — для фронта при подключении бокса
  void fillHardwareInfo(JsonObject info) const;
  void printStatus();

  // Команды бэкенда. Пока идёт замер или калибровка, новая команда получает ошибку busy
  void startScale(ScaleAction action, double grams);
  void startCalibration(int numOfPieces);
  // Останавливает калибровку без события
  void cancelCalibration();
  bool applyIndicators(const String &ledColor, bool hasNumber, int screenNumber);
  // Нет связи с бэкендом — дисплей показывает количество, посчитанное самим боксом
  void setBackendOnline(bool online);
  // true один раз после итога настройки или калибровки; event — отчёт для топика events (box_id добавляет BoxApp)
  bool takeResult(JsonObject event);

  static ScaleAction parseScaleAction(const String &name);

private:
  enum class Step { None, RemoveCell, InsertFilled, MeasurePieces, WriteTag };

  void onWindow();
  void onCellChanged();
  void onTagWritten(NfcReader::WriteResult result);

  // Серия окон подряд, каждое из которых отличается от предыдущего меньше чем на NOISE_UNITS
  void trackStability();
  void restartStability();
  bool stable() const {
    return stableWindows_ >= AppConfig::STABLE_WINDOWS;
  }
  // Среднее по стабильной серии или, если её нет, последнее окно
  double measuredRaw() const;
  void updateReportedWeight();
  void refreshDisplay();

  bool busy() const {
    return scaleAction_ != ScaleAction::None || step_ != Step::None;
  }
  void reportBusy(const char *event, ScaleAction action);
  void advanceScale();
  void finishScale(bool success, const char *reason, double value = 0);

  void setStep(Step step);
  void advanceCalibration();
  void finishCalibration(bool success, const char *reason);
  void showResult(bool success);

  bool slotReady() const {
    return hasZero_ && countsPerGram_ != 0;
  }
  bool cellTared() const;
  // Вес содержимого можно считать: слот настроен, ячейка знает свою тару, ничего не меряется
  bool measurable() const;
  double pieceWeight() const;
  double grams(double raw) const;
  double contentWeight(double raw) const;
  int pieces() const;
  const char *stepName() const;
  static const char *actionName(ScaleAction action);

  const uint8_t id_;
  const LockerHardware hardware_;
  BoxStorage &storage_;
  LoadCellBus &loadCellBus_;
  LoadCell loadCell_;
  NfcReader nfc_;
  CountDisplay display_;
  IndicatorLed led_;

  bool hasZero_ = false;
  double zeroRaw_ = 0;
  // Отсчётов HX711 на грамм; 0 — слот ещё не настроен гирей
  double countsPerGram_ = 0;

  bool windowReady_ = false;
  bool loadCellFailureLogged_ = false;
  uint8_t stableWindows_ = 0;
  double stableSum_ = 0;
  double previousRaw_ = 0;
  bool settled_ = true;
  unsigned long insertedAtMs_ = 0;

  // Вес, который уходит в box_data и на дисплей: меняется, только когда сдвиг больше шума (гистерезис)
  double reportedWeight_ = 0;
  bool reportedValid_ = false;

  ScaleAction scaleAction_ = ScaleAction::None;
  double referenceGrams_ = 0;
  unsigned long scaleStartedMs_ = 0;
  bool scaleWriting_ = false;
  double measuredTare_ = 0;

  Step step_ = Step::None;
  int pendingPieces_ = 0;
  double measuredContent_ = 0;

  // Итог для топика events; пустой — отправлять нечего
  JsonDocument result_;
  bool resultShown_ = false;
  bool resultOk_ = false;
  unsigned long resultShownAtMs_ = 0;

  bool backendOnline_ = false;
  // Бэкенд прислал команду indicators после последнего выхода на связь
  bool hasScreenCommand_ = false;
  bool screenBlank_ = false;
  int screenNumber_ = 0;
};
