#pragma once

#include <Arduino.h>
#include <Preferences.h>

#include "NetworkSettings.h"

// Энергонезависимая память бокса (NVS): настройки сети, box_id и настройка тензодатчика каждого слота — ноль и
// масштаб. Данные ячеек (тара, вес штуки) живут в их NFC-метках
class BoxStorage {
public:
  void begin();

  NetworkSettings networkSettings();
  void saveNetworkSettings(const NetworkSettings &settings);

  String boxId();
  void saveBoxId(const String &boxId);
  void forgetBoxId();
  // Стереть всё, кроме настроек сети: box_id и сведения о слотах. Бокс начнёт с чистого листа, но останется в сети
  void resetKeepingNetwork();

  // Сырое показание HX711 пустого слота; false — ноль ещё не задан
  bool loadZero(uint8_t lockerId, double &raw);
  void saveZero(uint8_t lockerId, double raw);
  // Отсчётов HX711 на грамм, со знаком направления датчика; 0 — слот ещё не настроен гирей
  double countsPerGram(uint8_t lockerId);
  void saveCountsPerGram(uint8_t lockerId, double countsPerGram);

private:
  static String key(const char *prefix, uint8_t lockerId);

  Preferences prefs_;
};
