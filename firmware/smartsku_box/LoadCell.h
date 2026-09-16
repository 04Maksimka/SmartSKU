#pragma once

#include <Arduino.h>
#include <HX711.h>

#include "AppConfig.h"

// Тензодатчик на HX711: копит сырые отсчёты и раз в окно выдаёт среднее значение
class LoadCell {
public:
  LoadCell(int8_t doutPin, int8_t sckPin);

  void begin();
  // true, если только что закрылось окно; тогда average()/hasSignal() относятся к нему
  bool update();
  // Выбросить накопленное: следующее окно начнётся с чистого листа (после тары, калибровки)
  void restartWindow();

  bool hasSignal() const {
    return lastSampleCount_ > 0;
  }
  // Несколько окон подряд без данных — проблема с проводкой, а не случайная задержка цикла
  bool failed() const {
    return emptyWindows_ >= AppConfig::HX711_MAX_EMPTY_WINDOWS;
  }
  double average() const {
    return lastAverage_;
  }
  uint32_t lastSampleCount() const {
    return lastSampleCount_;
  }

private:
  const int8_t doutPin_;
  const int8_t sckPin_;
  HX711 hx_;
  int64_t sampleSum_ = 0;
  uint32_t sampleCount_ = 0;
  unsigned long windowStartMs_ = 0;
  double lastAverage_ = 0;
  uint32_t lastSampleCount_ = 0;
  uint8_t emptyWindows_ = 0;
};
