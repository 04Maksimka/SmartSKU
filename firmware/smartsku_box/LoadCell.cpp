#include "LoadCell.h"

#include "AppConfig.h"

LoadCell::LoadCell(int8_t doutPin, int8_t sckPin) : doutPin_(doutPin), sckPin_(sckPin) {}

void LoadCell::begin() {
  hx_.begin(doutPin_, sckPin_, AppConfig::HX711_GAIN);
  restartWindow();
}

void LoadCell::restartWindow() {
  sampleSum_ = 0;
  sampleCount_ = 0;
  windowStartMs_ = millis();
}

bool LoadCell::update() {
  if (hx_.is_ready()) {
    sampleSum_ += hx_.read();
    ++sampleCount_;
  }
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
