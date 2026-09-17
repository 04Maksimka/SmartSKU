#include "LoadCell.h"

void LoadCell::begin() {
  restartWindow();
}

void LoadCell::restartWindow() {
  sampleSum_ = 0;
  sampleCount_ = 0;
  windowStartMs_ = millis();
}

void LoadCell::addSample(int32_t value) {
  sampleSum_ += value;
  ++sampleCount_;
}

bool LoadCell::update() {
  if (millis() - windowStartMs_ < AppConfig::MEASURE_WINDOW_MS) {
    return false;
  }
  lastSampleCount_ = sampleCount_;
  if (sampleCount_ > 0) {
    lastAverage_ = static_cast<double>(sampleSum_) / sampleCount_;
    emptyWindows_ = 0;
  } else if (emptyWindows_ < UINT8_MAX) {
    ++emptyWindows_;
  }
  restartWindow();
  return true;
}
