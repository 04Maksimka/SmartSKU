#include "Locker.h"

#include <algorithm>
#include <cmath>

Locker::Locker(uint8_t lockerId, const LockerHardware &hardware, BoxStorage &storage)
  : id_(lockerId),
    hardware_(hardware),
    invertLoad_(hardware.invertLoad),
    storage_(storage),
    loadCell_(hardware.hxDout, hardware.hxSck),
    nfc_(hardware.rfidSs, hardware.rfidRst),
    display_(hardware.displayClk, hardware.displayDio),
    led_(hardware.ledRed, hardware.ledGreen) {}

void Locker::begin() {
  display_.begin(AppConfig::DISPLAY_BRIGHTNESS);
  led_.begin();
  loadCell_.begin();
  nfc_.begin(id_);
  hasZero_ = storage_.loadZero(id_, zeroOffset_);
  if (hasZero_) {
    Serial.printf("[locker %u] zero: %.0f\n", id_, zeroOffset_);
  } else {
    Serial.printf("[locker %u] no zero yet: insert the EMPTY cell and set zero from the dashboard (or send 't')\n", id_);
  }
}

void Locker::update() {
  if (nfc_.update()) {
    onCellChanged();
  }
  if (loadCell_.update()) {
    onWindow();
  }
}

void Locker::onCellChanged() {
  pieceWeight_ = nfc_.present() ? storage_.pieceWeight(nfc_.uid()) : 0;
  emptyWarned_ = false;
  if (nfc_.present()) {
    // Последнее окно мерило слот без ячейки — ждём свежих и стабильных показаний
    settled_ = false;
    insertedAtMs_ = millis();
    stableWindows_ = 0;
    windowReady_ = false;
    loadCell_.restartWindow();
    if (pieceWeight_ > 0) {
      Serial.printf("[locker %u] cell %s: piece weight %.2f\n", id_, nfc_.uid().c_str(), pieceWeight_);
    }
  } else {
    settled_ = true;
    reportedWeight_ = 0;
    if (pendingPieces_ > 0) {
      cellWasRemoved_ = true;
    }
  }
  refreshDisplay();
}

void Locker::onWindow() {
  if (loadCell_.failed()) {
    windowReady_ = false;
    display_.showError();
    Serial.printf("[locker %u] ERROR: no HX711 data, check wiring\n", id_);
    return;
  }
  if (!loadCell_.hasSignal()) {
    // Цикл был занят: окно пустое, прошлое среднее остаётся в силе
    return;
  }
  windowReady_ = true;
  if (tareWindowsLeft_ > 0) {
    applyTare();
    return;
  }
  trackSettling();
  trackCalibration();
  updateReportedWeight();
  refreshDisplay();
}

bool Locker::requestTare() {
  if (!nfc_.present() || loadCell_.failed()) {
    Serial.printf("[locker %u] tare rejected: insert the empty cell and check HX711\n", id_);
    return false;
  }
  tareWindowsLeft_ = AppConfig::TARE_WINDOWS;
  tareSum_ = 0;
  loadCell_.restartWindow();
  display_.showDashes();
  Serial.printf(
    "[locker %u] taring: keep the empty cell still for %lu ms\n", id_, AppConfig::MEASURE_WINDOW_MS * AppConfig::TARE_WINDOWS
  );
  return true;
}

void Locker::applyTare() {
  tareSum_ += loadCell_.average();
  if (--tareWindowsLeft_ > 0) {
    return;
  }
  zeroOffset_ = tareSum_ / AppConfig::TARE_WINDOWS;
  hasZero_ = true;
  storage_.saveZero(id_, zeroOffset_);
  reportedWeight_ = 0;
  Serial.printf("[locker %u] zero saved: %.0f. Put something into the cell: net must grow, otherwise set invertLoad\n", id_, zeroOffset_);
  refreshDisplay();
}

void Locker::trackSettling() {
  double weight = measuredWeight();
  bool stable = stableWindows_ > 0 && std::fabs(weight - previousWeight_) < AppConfig::NOISE_UNITS;
  stableWindows_ = stable ? stableWindows_ + 1 : 1;
  previousWeight_ = weight;
  if (settled_) {
    return;
  }
  if (stableWindows_ >= AppConfig::STABLE_WINDOWS) {
    settled_ = true;
  } else if (millis() - insertedAtMs_ >= AppConfig::SETTLE_TIMEOUT_MS) {
    settled_ = true;
    Serial.printf("[locker %u] weight is not stable after insert, reporting anyway\n", id_);
  }
  if (settled_) {
    // Первое значение после вставки отправляем как есть, без гистерезиса
    reportedWeight_ = weight;
  }
}

// Вес штуки считаем только по установившемуся весу, в том же окне, что и первая телеметрия после вставки
void Locker::trackCalibration() {
  if (pendingPieces_ <= 0 || !cellWasRemoved_ || !nfc_.present() || !hasZero_ || !settled_) {
    return;
  }
  double weight = measuredWeight();
  if (weight < AppConfig::EMPTY_UNITS) {
    if (!emptyWarned_) {
      Serial.printf("[locker %u] cell looks empty (%.0f), calibration still waits for components\n", id_, weight);
      emptyWarned_ = true;
    }
    return;
  }
  pieceWeight_ = weight / pendingPieces_;
  storage_.savePieceWeight(nfc_.uid(), pieceWeight_);
  reportedWeight_ = weight;
  Serial.printf("[locker %u] calibrated cell %s: %.0f / %d = %.2f per piece\n", id_, nfc_.uid().c_str(), weight, pendingPieces_, pieceWeight_);
  pendingPieces_ = 0;
  cellWasRemoved_ = false;
}

// Гистерезис: шум не превращается в поток изменений на бэкенде, а сдвиг на полштуки виден всегда
void Locker::updateReportedWeight() {
  if (!settled_) {
    return;
  }
  double threshold = AppConfig::NOISE_UNITS;
  if (pieceWeight_ > 0) {
    threshold = std::min(threshold, pieceWeight_ / 2);
  }
  double weight = measuredWeight();
  if (std::fabs(weight - reportedWeight_) >= threshold) {
    reportedWeight_ = weight;
  }
}

void Locker::startCalibration(int numOfPieces) {
  pendingPieces_ = numOfPieces;
  // Если ячейка уже вынута, ждём только вставки; иначе сначала её должны вынуть и насыпать компоненты
  cellWasRemoved_ = !nfc_.present();
  emptyWarned_ = false;
  Serial.printf("[locker %u] calibration for %d pieces: pull the cell out, fill it and insert back\n", id_, numOfPieces);
}

bool Locker::applyIndicators(const String &ledColor, int screenNumber) {
  hasScreenNumber_ = true;
  screenNumber_ = screenNumber;
  refreshDisplay();
  return led_.apply(ledColor);
}

void Locker::setBackendOnline(bool online) {
  if (online == backendOnline_) {
    return;
  }
  backendOnline_ = online;
  // После обрыва связи прошлая команда могла устареть: пока бэкенд не пришлёт новую, считаем сами
  hasScreenNumber_ = false;
  refreshDisplay();
}

void Locker::refreshDisplay() {
  if (tareWindowsLeft_ > 0) {
    return;
  }
  if (!hasZero_) {
    display_.showDashes();
    return;
  }
  if (backendOnline_ && hasScreenNumber_) {
    display_.showNumber(screenNumber_);
    return;
  }
  if (!ready() || !nfc_.present() || pieceWeight_ <= 0) {
    display_.showDashes();
    return;
  }
  display_.showNumber(pieces());
}

double Locker::net() const {
  double value = loadCell_.average() - zeroOffset_;
  return invertLoad_ ? -value : value;
}

double Locker::measuredWeight() const {
  if (!nfc_.present() || !hasZero_ || !windowReady_) {
    return 0;
  }
  return std::max(0.0, net());
}

int Locker::pieces() const {
  if (pieceWeight_ <= 0) {
    return 0;
  }
  return static_cast<int>(std::lround(reportedWeight_ / pieceWeight_));
}

void Locker::fillReading(JsonObject reading) const {
  bool present = nfc_.present();
  reading["locker_id"] = id_;
  reading["nfc_flag"] = present;
  reading["nfc_id"] = present ? nfc_.uid() : String();
  reading["weight"] = present ? std::round(reportedWeight_ * 10) / 10 : 0.0;
  reading["piece_weight"] = present ? std::round(pieceWeight_ * 100) / 100 : 0.0;
  reading["number_of_pieces"] = present ? pieces() : 0;
  reading["zeroed"] = hasZero_;
}

void Locker::fillHardwareInfo(JsonObject info) const {
  info["locker_id"] = id_;
  info["load_cell"] = hardware_.hxDout >= 0 && windowReady_ && !loadCell_.failed();
  info["nfc_reader"] = nfc_.chipFound();
  info["display"] = hardware_.displayClk >= 0 && hardware_.displayDio >= 0;
  info["led"] = hardware_.ledRed >= 0 || hardware_.ledGreen >= 0;
  info["zeroed"] = hasZero_;
  info["cell"] = nfc_.present() ? nfc_.uid() : String();
}

void Locker::printStatus() const {
  Serial.printf(
    "[locker %u] raw %.0f (%lu samples) | net %.0f | weight %.0f | cell %s | piece %.2f | pieces %d", id_, loadCell_.average(),
    static_cast<unsigned long>(loadCell_.lastSampleCount()), net(), reportedWeight_, nfc_.present() ? nfc_.uid().c_str() : "-", pieceWeight_,
    pieces()
  );
  if (!hasZero_) {
    Serial.print(" | no zero: send 't'");
  }
  if (!nfc_.chipFound()) {
    Serial.print(" | RC522 not found");
  }
  if (pendingPieces_ > 0) {
    Serial.printf(" | calibration: %d pieces, %s", pendingPieces_, cellWasRemoved_ ? "waiting for insert" : "waiting for pull-out");
  }
  Serial.println();
}
