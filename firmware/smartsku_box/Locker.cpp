#include "Locker.h"

#include <algorithm>
#include <cmath>

Locker::Locker(uint8_t lockerId, const LockerHardware &hardware, BoxStorage &storage, LoadCellBus &loadCellBus)
  : id_(lockerId),
    hardware_(hardware),
    storage_(storage),
    loadCellBus_(loadCellBus),
    nfc_(hardware.rfidSs),
    display_(AppConfig::DISPLAY_CLK, hardware.displayDio) {}

void Locker::deselectNfc() {
  nfc_.deselect();
}

void Locker::begin() {
  display_.begin(AppConfig::DISPLAY_BRIGHTNESS);
  loadCellBus_.attach(hardware_.hxDout, loadCell_);
  loadCell_.begin();
  nfc_.begin(id_);
  hasZero_ = storage_.loadZero(id_, zeroRaw_);
  countsPerGram_ = storage_.countsPerGram(id_);
  if (slotReady()) {
    Serial.printf("[locker %u] zero %.0f, %.2f counts per gram\n", id_, zeroRaw_, countsPerGram_);
  } else {
    Serial.printf("[locker %u] load cell is not set up: zero it and put the reference weight on it\n", id_);
  }
}

void Locker::update() {
  if (loadCell_.update()) {
    onWindow();
  }
  if (resultShown_ && millis() - resultShownAtMs_ >= AppConfig::RESULT_SHOW_MS) {
    resultShown_ = false;
    refreshDisplay();
  }
}

void Locker::pollNfc() {
  if (nfc_.update()) {
    onCellChanged();
  }
  NfcReader::WriteResult written = nfc_.takeWriteResult();
  if (written != NfcReader::WriteResult::None) {
    onTagWritten(written);
  }
}

void Locker::onCellChanged() {
  // Текущее окно мерило слот ещё в прошлом состоянии — ждём свежих показаний
  restartStability();
  loadCell_.restartWindow();
  windowReady_ = false;
  reportedValid_ = false;
  bool present = nfc_.present();
  settled_ = !present;
  insertedAtMs_ = millis();

  if (scaleAction_ == ScaleAction::CellTare && !present && !scaleWriting_) {
    finishScale(false, "no_cell");
  } else if ((scaleAction_ == ScaleAction::Zero || scaleAction_ == ScaleAction::Reference) && present) {
    finishScale(false, "cell_present");
  }
  switch (step_) {
    case Step::RemoveCell:
    case Step::MeasurePieces:
      setStep(present ? step_ : Step::InsertFilled);
      break;
    case Step::InsertFilled:
      setStep(present ? Step::MeasurePieces : step_);
      break;
    default:
      // Если ячейку выдернули посреди записи, NfcReader сообщит о неудаче
      break;
  }
  refreshDisplay();
}

void Locker::onWindow() {
  if (loadCell_.failed()) {
    windowReady_ = false;
    if (scaleAction_ != ScaleAction::None) {
      finishScale(false, "load_cell_failed");
    }
    if (step_ != Step::None) {
      finishCalibration(false, "load_cell_failed");
    }
    display_.showError();
    if (!loadCellFailureLogged_) {
      loadCellFailureLogged_ = true;
      Serial.printf("[locker %u] ERROR: no HX711 data, check wiring (slot is not reported until it recovers)\n", id_);
    }
    return;
  }
  if (!loadCell_.hasSignal()) {
    // Цикл был занят: окно пустое, прошлое среднее остаётся в силе
    return;
  }
  if (loadCellFailureLogged_) {
    loadCellFailureLogged_ = false;
    Serial.printf("[locker %u] HX711 data is back\n", id_);
  }
  windowReady_ = true;
  trackStability();
  if (!settled_ && (stable() || millis() - insertedAtMs_ >= AppConfig::SETTLE_TIMEOUT_MS)) {
    settled_ = true;
  }
  if (scaleAction_ != ScaleAction::None) {
    advanceScale();
  }
  if (step_ != Step::None) {
    advanceCalibration();
  }
  updateReportedWeight();
  refreshDisplay();
}

void Locker::trackStability() {
  double raw = loadCell_.average();
  if (stableWindows_ > 0 && std::fabs(raw - previousRaw_) < AppConfig::NOISE_UNITS) {
    if (stableWindows_ < AppConfig::STABLE_AVERAGE_WINDOWS) {
      ++stableWindows_;
      stableSum_ += raw;
    } else {
      // Скользящее среднее по последним окнам: медленный дрейф не тянет за собой старые значения
      stableSum_ += raw - stableSum_ / stableWindows_;
    }
  } else {
    stableWindows_ = 1;
    stableSum_ = raw;
  }
  previousRaw_ = raw;
}

void Locker::restartStability() {
  stableWindows_ = 0;
  stableSum_ = 0;
}

double Locker::measuredRaw() const {
  return stableWindows_ > 0 ? stableSum_ / stableWindows_ : loadCell_.average();
}

// Гистерезис: шум не превращается в поток изменений на бэкенде, а сдвиг на полштуки виден всегда
void Locker::updateReportedWeight() {
  if (!measurable()) {
    reportedValid_ = false;
    return;
  }
  double weight = contentWeight(loadCell_.average());
  double threshold = AppConfig::REPORT_STEP_GRAMS;
  if (pieceWeight() > 0) {
    threshold = std::min(threshold, pieceWeight() / 2);
  }
  if (!reportedValid_ || std::fabs(weight - reportedWeight_) >= threshold) {
    reportedWeight_ = weight;
    reportedValid_ = true;
  }
}

Locker::ScaleAction Locker::parseScaleAction(const String &name) {
  if (name == "zero") {
    return ScaleAction::Zero;
  }
  if (name == "reference") {
    return ScaleAction::Reference;
  }
  if (name == "cell_tare") {
    return ScaleAction::CellTare;
  }
  return ScaleAction::None;
}

void Locker::startScale(ScaleAction action, double grams) {
  if (busy()) {
    reportBusy("scale_failed", action);
    return;
  }
  scaleAction_ = action;
  referenceGrams_ = grams;
  scaleWriting_ = false;
  resultShown_ = false;
  Serial.printf("[locker %u] %s started\n", id_, actionName(action));
  bool present = nfc_.present();
  if (loadCell_.failed()) {
    finishScale(false, "load_cell_failed");
  } else if (action != ScaleAction::CellTare && present) {
    finishScale(false, "cell_present");
  } else if (action == ScaleAction::Reference && !hasZero_) {
    finishScale(false, "slot_not_zeroed");
  } else if (action == ScaleAction::CellTare && !present) {
    finishScale(false, "no_cell");
  } else if (action == ScaleAction::CellTare && !slotReady()) {
    finishScale(false, "slot_not_ready");
  } else {
    // Мерим только то, что лежит на площадке после команды
    restartStability();
    loadCell_.restartWindow();
    scaleStartedMs_ = millis();
    refreshDisplay();
  }
}

void Locker::advanceScale() {
  if (scaleWriting_) {
    return;
  }
  if (!stable()) {
    if (millis() - scaleStartedMs_ >= AppConfig::SETTLE_TIMEOUT_MS) {
      finishScale(false, "unstable");
    }
    return;
  }
  double raw = measuredRaw();
  switch (scaleAction_) {
    case ScaleAction::Zero:
      zeroRaw_ = raw;
      hasZero_ = true;
      storage_.saveZero(id_, zeroRaw_);
      finishScale(true, "", zeroRaw_);
      break;
    case ScaleAction::Reference: {
      double delta = raw - zeroRaw_;
      if (std::fabs(delta) < AppConfig::MIN_LOAD_UNITS) {
        finishScale(false, "no_weight_change");
        return;
      }
      // Знак масштаба — направление датчика: у части датчиков нагрузка уменьшает показания
      countsPerGram_ = delta / referenceGrams_;
      storage_.saveCountsPerGram(id_, countsPerGram_);
      finishScale(true, "", countsPerGram_);
      break;
    }
    case ScaleAction::CellTare: {
      if (nfc_.tagState() == NfcReader::TagState::Unsupported) {
        finishScale(false, "tag_unsupported");
        return;
      }
      if (nfc_.tagState() != NfcReader::TagState::Ready) {
        return;
      }
      measuredTare_ = grams(raw);
      if (measuredTare_ < AppConfig::MIN_LOAD_GRAMS) {
        finishScale(false, "no_weight_change");
        return;
      }
      CellTag tag = nfc_.tag();
      tag.hasTare = true;
      tag.tare = measuredTare_;
      nfc_.requestWrite(tag);
      scaleWriting_ = true;
      break;
    }
    case ScaleAction::None:
      break;
  }
}

void Locker::finishScale(bool success, const char *reason, double value) {
  result_.clear();
  result_["event"] = success ? "scale_done" : "scale_failed";
  result_["locker_id"] = id_;
  result_["action"] = actionName(scaleAction_);
  if (success) {
    result_["value"] = std::round(value * 100) / 100;
    if (scaleAction_ == ScaleAction::CellTare) {
      result_["nfc_id"] = nfc_.uid();
    }
    Serial.printf("[locker %u] %s done: %.2f\n", id_, actionName(scaleAction_), value);
  } else {
    result_["reason"] = reason;
    Serial.printf("[locker %u] %s failed: %s\n", id_, actionName(scaleAction_), reason);
  }
  scaleAction_ = ScaleAction::None;
  scaleWriting_ = false;
  showResult(success);
}

// Отказ новой команде, а то, что уже идёт, продолжается
void Locker::reportBusy(const char *event, ScaleAction action) {
  Serial.printf("[locker %u] busy, %s refused\n", id_, action == ScaleAction::None ? "calibration" : actionName(action));
  result_.clear();
  result_["event"] = event;
  result_["locker_id"] = id_;
  if (action != ScaleAction::None) {
    result_["action"] = actionName(action);
  }
  result_["reason"] = "busy";
}

void Locker::startCalibration(int numOfPieces) {
  if (busy()) {
    reportBusy("calibration_failed", ScaleAction::None);
    return;
  }
  pendingPieces_ = numOfPieces;
  resultShown_ = false;
  bool present = nfc_.present();
  if (loadCell_.failed()) {
    finishCalibration(false, "load_cell_failed");
  } else if (!slotReady()) {
    finishCalibration(false, "slot_not_ready");
  } else if (present && nfc_.tagState() == NfcReader::TagState::Unsupported) {
    finishCalibration(false, "tag_unsupported");
  } else if (present && nfc_.tagState() == NfcReader::TagState::Ready && !nfc_.tag().hasTare) {
    finishCalibration(false, "cell_not_tared");
  } else {
    setStep(present ? Step::RemoveCell : Step::InsertFilled);
  }
}

void Locker::cancelCalibration() {
  if (step_ == Step::None) {
    return;
  }
  Serial.printf("[locker %u] calibration cancelled\n", id_);
  step_ = Step::None;
  pendingPieces_ = 0;
  reportedValid_ = false;
  refreshDisplay();
}

void Locker::setStep(Step step) {
  if (step == step_) {
    return;
  }
  step_ = step;
  Serial.printf("[locker %u] calibration: %s\n", id_, stepName());
  refreshDisplay();
}

void Locker::advanceCalibration() {
  if (step_ != Step::MeasurePieces || !nfc_.present() || !settled_) {
    return;
  }
  switch (nfc_.tagState()) {
    case NfcReader::TagState::Unsupported:
      finishCalibration(false, "tag_unsupported");
      return;
    case NfcReader::TagState::Ready:
      break;
    default:
      return;
  }
  if (!cellTared()) {
    finishCalibration(false, "cell_not_tared");
    return;
  }
  double content = contentWeight(measuredRaw());
  if (content < AppConfig::MIN_LOAD_GRAMS) {
    Serial.printf("[locker %u] the cell looks empty (%.1f g): pull it out and pour %d pieces\n", id_, content, pendingPieces_);
    setStep(Step::RemoveCell);
    return;
  }
  measuredContent_ = content;
  CellTag tag = nfc_.tag();
  tag.hasPiece = true;
  tag.pieceWeight = content / pendingPieces_;
  nfc_.requestWrite(tag);
  setStep(Step::WriteTag);
}

void Locker::finishCalibration(bool success, const char *reason) {
  result_.clear();
  result_["event"] = success ? "calibration_done" : "calibration_failed";
  result_["locker_id"] = id_;
  if (success) {
    result_["nfc_id"] = nfc_.uid();
    result_["piece_weight"] = std::round(nfc_.tag().pieceWeight * 1000) / 1000;
    result_["weight"] = std::round(measuredContent_ * 10) / 10;
    Serial.printf("[locker %u] calibrated: %.1f g / %d = %.3f g\n", id_, measuredContent_, pendingPieces_, nfc_.tag().pieceWeight);
  } else {
    result_["reason"] = reason;
    Serial.printf("[locker %u] calibration failed: %s\n", id_, reason);
  }
  step_ = Step::None;
  pendingPieces_ = 0;
  reportedValid_ = false;
  showResult(success);
}

void Locker::eraseTag() {
  if (busy() || erasingTag_) {
    Serial.printf("[locker %u] busy, tag erase refused\n", id_);
  } else if (!nfc_.present()) {
    Serial.printf("[locker %u] no cell, nothing to erase\n", id_);
  } else {
    nfc_.requestWrite(CellTag());
    erasingTag_ = true;
  }
}

void Locker::onTagWritten(NfcReader::WriteResult result) {
  bool ok = result == NfcReader::WriteResult::Done;
  if (erasingTag_) {
    erasingTag_ = false;
    Serial.printf("[locker %u] tag erase %s\n", id_, ok ? "done" : "failed");
  } else if (scaleAction_ == ScaleAction::CellTare && scaleWriting_) {
    finishScale(ok, "tag_write_failed", measuredTare_);
  } else if (step_ == Step::WriteTag) {
    finishCalibration(ok, "tag_write_failed");
  }
}

void Locker::showResult(bool success) {
  resultShown_ = true;
  resultOk_ = success;
  resultShownAtMs_ = millis();
  refreshDisplay();
}

bool Locker::takeResult(JsonObject event) {
  if (result_.isNull()) {
    return false;
  }
  event.set(result_.as<JsonObjectConst>());
  result_.clear();
  return true;
}

Locker::ScreenMode Locker::parseScreenMode(const String &name) {
  if (name == "off") {
    return ScreenMode::Off;
  }
  if (name == "take") {
    return ScreenMode::Take;
  }
  if (name == "put") {
    return ScreenMode::Put;
  }
  return ScreenMode::Count;
}

void Locker::applyIndicators(ScreenMode mode, bool hasNumber, int screenNumber) {
  hasScreenCommand_ = true;
  screenMode_ = mode;
  screenBlank_ = !hasNumber;
  screenNumber_ = screenNumber;
  refreshDisplay();
}

void Locker::setBackendOnline(bool online) {
  if (online == backendOnline_) {
    return;
  }
  backendOnline_ = online;
  // После обрыва связи прошлая команда могла устареть: пока бэкенд не пришлёт новую, считаем сами
  hasScreenCommand_ = false;
  refreshDisplay();
}

void Locker::refreshDisplay() {
  if (resultShown_) {
    if (resultOk_) {
      display_.showDone();
    } else {
      display_.showError();
    }
    return;
  }
  if (scaleAction_ != ScaleAction::None) {
    display_.showHold();
    return;
  }
  switch (step_) {
    case Step::RemoveCell:
      display_.showPullOut();
      return;
    case Step::InsertFilled:
      display_.showInsert();
      return;
    case Step::MeasurePieces:
    case Step::WriteTag:
      display_.showHold();
      return;
    case Step::None:
      break;
  }
  if (loadCell_.failed()) {
    display_.showError();
    return;
  }
  if (backendOnline_ && hasScreenCommand_) {
    if (screenMode_ == ScreenMode::Off) {
      display_.showBlank();
    } else if (screenMode_ == ScreenMode::Take || screenMode_ == ScreenMode::Put) {
      display_.showTask(screenMode_ == ScreenMode::Take ? CountDisplay::LETTER_TAKE : CountDisplay::LETTER_PUT,
                        screenNumber_);
    } else if (screenBlank_) {
      display_.showDashes();
    } else {
      display_.showNumber(screenNumber_);
    }
    return;
  }
  if (!measurable() || pieceWeight() <= 0) {
    display_.showDashes();
    return;
  }
  display_.showNumber(pieces());
}

bool Locker::cellTared() const {
  return nfc_.present() && nfc_.tagState() == NfcReader::TagState::Ready && nfc_.tag().hasTare;
}

bool Locker::measurable() const {
  return !busy() && windowReady_ && settled_ && slotReady() && cellTared();
}

double Locker::pieceWeight() const {
  if (!nfc_.present() || nfc_.tagState() != NfcReader::TagState::Ready || !nfc_.tag().hasPiece) {
    return 0;
  }
  return nfc_.tag().pieceWeight;
}

double Locker::grams(double raw) const {
  return (raw - zeroRaw_) / countsPerGram_;
}

// Может быть меньше нуля: ноль слота уплыл или тара записана с ошибкой. Не прячем это, количество не меньше 0
double Locker::contentWeight(double raw) const {
  return grams(raw) - nfc_.tag().tare;
}

int Locker::pieces() const {
  if (!measurable() || pieceWeight() <= 0) {
    return 0;
  }
  return std::max(0, static_cast<int>(std::lround(reportedWeight_ / pieceWeight())));
}

const char *Locker::stepName() const {
  switch (step_) {
    case Step::RemoveCell:
      return "remove_cell";
    case Step::InsertFilled:
      return "insert_filled";
    case Step::MeasurePieces:
    case Step::WriteTag:
      // Запись в метку — часть замера, отдельным шагом фронту она не нужна
      return "measure_pieces";
    case Step::None:
      break;
  }
  return "";
}

const char *Locker::actionName(ScaleAction action) {
  switch (action) {
    case ScaleAction::Zero:
      return "zero";
    case ScaleAction::Reference:
      return "reference";
    case ScaleAction::CellTare:
      return "cell_tare";
    case ScaleAction::None:
      break;
  }
  return "none";
}

void Locker::fillReading(JsonObject reading) const {
  bool present = nfc_.present();
  reading["locker_id"] = id_;
  reading["nfc_flag"] = present;
  reading["nfc_id"] = present ? nfc_.uid() : String();
  reading["weight"] = measurable() ? std::round(reportedWeight_ * 10) / 10 : 0.0;
  reading["piece_weight"] = std::round(pieceWeight() * 1000) / 1000;
  reading["number_of_pieces"] = pieces();
  reading["slot_ready"] = slotReady();
  reading["cell_tared"] = cellTared();
  reading["tag_error"] = present && nfc_.tagState() == NfcReader::TagState::Unsupported;
  if (step_ == Step::None) {
    reading["calibration"] = nullptr;
    return;
  }
  JsonObject calibration = reading["calibration"].to<JsonObject>();
  calibration["step"] = stepName();
  calibration["num_of_pieces"] = pendingPieces_;
}

void Locker::fillHardwareInfo(JsonObject info) const {
  info["locker_id"] = id_;
  info["load_cell"] = hardware_.hxDout >= 0 && windowReady_ && !loadCell_.failed();
  info["nfc_reader"] = nfc_.chipFound();
  info["display"] = AppConfig::DISPLAY_CLK >= 0 && hardware_.displayDio >= 0;
  info["slot_ready"] = slotReady();
  info["cell"] = nfc_.present() ? nfc_.uid() : String();
}

void Locker::printStatus() {
  double raw = loadCell_.average();
  Serial.printf("[locker %u] raw %.0f (%lu samples, stable %u)", id_, raw, static_cast<unsigned long>(loadCell_.lastSampleCount()), stableWindows_);
  if (slotReady()) {
    Serial.printf(" | zero %.0f, %.2f/g | %.1f g", zeroRaw_, countsPerGram_, grams(raw));
  } else {
    Serial.printf(" | not set up (zero %s, scale %s)", hasZero_ ? "ok" : "-", countsPerGram_ != 0 ? "ok" : "-");
  }
  if (nfc_.present()) {
    Serial.printf(" | cell %s", nfc_.uid().c_str());
    const CellTag &tag = nfc_.tag();
    switch (nfc_.tagState()) {
      case NfcReader::TagState::Ready:
        Serial.printf(" tare %s piece %s", tag.hasTare ? String(tag.tare, 1).c_str() : "-", tag.hasPiece ? String(tag.pieceWeight, 3).c_str() : "-");
        break;
      case NfcReader::TagState::Unsupported:
        Serial.print(" TAG UNREADABLE");
        break;
      default:
        Serial.print(" tag reading");
        break;
    }
    if (measurable()) {
      Serial.printf(" | content %.1f g | pieces %d", reportedWeight_, pieces());
    }
  } else {
    Serial.print(" | no cell");
  }
  if (scaleAction_ != ScaleAction::None) {
    Serial.printf(" | %s", actionName(scaleAction_));
  }
  if (step_ != Step::None) {
    Serial.printf(" | calibration: %s", stepName());
  }
  Serial.printf(" | %s", nfc_.takeDiagnostics().c_str());
  if (loadCell_.failed()) {
    Serial.print(" | no HX711 data");
  }
  if (!nfc_.chipFound()) {
    Serial.print(" | RC522 not found");
  }
  Serial.println();
}
