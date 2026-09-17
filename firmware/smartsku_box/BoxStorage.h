#pragma once

#include <Arduino.h>
#include <Preferences.h>

#include "NetworkSettings.h"

// Энергонезависимая память бокса (NVS): настройки сети, box_id, ноль тензодатчика каждой ячейки, вес штуки для каждой
// NFC-метки.
// Всё это переживает перезагрузку: после включения ячейку уже нельзя тарировать — в ней может лежать крепёж
class BoxStorage {
public:
  void begin();

  NetworkSettings networkSettings();
  void saveNetworkSettings(const NetworkSettings &settings);

  String boxId();
  void saveBoxId(const String &boxId);
  void forgetBoxId();

  // Сырые показания HX711 с вставленной пустой ячейкой; false — ноль ещё не выставлялся
  bool loadZero(uint8_t lockerId, double &zeroOffset);
  void saveZero(uint8_t lockerId, double zeroOffset);

  // 0, если ячейка с этой меткой ещё не калибровалась в этом боксе
  double pieceWeight(const String &nfcId);
  void savePieceWeight(const String &nfcId, double pieceWeight);

private:
  static String zeroKey(uint8_t lockerId);
  // Ключ NVS не длиннее 15 символов, а UID бывает до 20 hex-символов — поэтому хэш
  static String pieceWeightKey(const String &nfcId);

  Preferences prefs_;
};
