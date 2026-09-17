#include "NfcReader.h"

#include "AppConfig.h"

// RST библиотеке не передаётся: им управляет hardResetAll()
NfcReader::NfcReader(int8_t ssPin) : ssPin_(ssPin), rfid_(ssPin, MFRC522::UNUSED_PIN) {}

void NfcReader::hardResetAll(int8_t rstPin) {
  if (rstPin < 0) {
    return;
  }
  pinMode(rstPin, OUTPUT);
  digitalWrite(rstPin, LOW);
  delay(AppConfig::RFID_RESET_PULSE_MS);
  digitalWrite(rstPin, HIGH);
  // Запуск генератора RC522
  delay(AppConfig::RFID_RESET_STARTUP_MS);
}

void NfcReader::deselect() {
  if (ssPin_ >= 0) {
    pinMode(ssPin_, OUTPUT);
    digitalWrite(ssPin_, HIGH);
  }
}

void NfcReader::begin(uint8_t lockerId) {
  lockerId_ = lockerId;
  if (ssPin_ < 0) {
    return;
  }
  init();
  byte version = rfid_.PCD_ReadRegister(MFRC522::VersionReg);
  // 0x00 и 0xFF — чип не отвечает по SPI (проводка, питание 3.3 В, SS/RST)
  chipFound_ = version != 0x00 && version != 0xFF;
  if (chipFound_) {
    Serial.printf("[nfc %u] RC522 firmware 0x%02X\n", lockerId_, version);
  } else {
    Serial.printf("[nfc %u] ERROR: RC522 not responding (version 0x%02X), check wiring\n", lockerId_, version);
  }
  rfid_.PCD_AntennaOff();
}

// Программный сброс и настройка регистров
void NfcReader::init() {
  rfid_.PCD_Init();
  rfid_.PCD_AntennaOff();
}

bool NfcReader::update() {
  // Молчащий чип не опрашиваем: каждый опрос стоил бы циклу таймаута
  if (!chipFound_) {
    return false;
  }
  String seen;
  bool found = poll(seen);
  // Без метки исправный RC522 отвечает таймаутом; ошибка раз за разом — чип сбился, настраиваем заново
  errorsInRow_ = lastStatus_ == MFRC522::STATUS_ERROR ? errorsInRow_ + 1 : 0;
  if (errorsInRow_ >= AppConfig::RFID_ERRORS_TO_REINIT) {
    Serial.printf("[nfc %u] %u communication errors in a row (ErrorReg 0x%02X), reinitializing\n", lockerId_, errorsInRow_, lastErrorReg_);
    errorsInRow_ = 0;
    init();
  }
  if (found) {
    misses_ = 0;
    if (present_ && seen == uid_) {
      return false;
    }
    present_ = true;
    uid_ = seen;
    Serial.printf("[nfc %u] cell inserted: %s\n", lockerId_, uid_.c_str());
    return true;
  }

  if (!present_ || ++misses_ < AppConfig::RFID_MISSES_TO_REMOVE) {
    return false;
  }
  Serial.printf("[nfc %u] cell removed: %s\n", lockerId_, uid_.c_str());
  present_ = false;
  uid_ = "";
  misses_ = 0;
  return true;
}

bool NfcReader::poll(String &uid) {
  rfid_.PCD_AntennaOn();
  delay(AppConfig::RFID_ANTENNA_SETTLE_MS);
  byte atqa[2];
  byte atqaSize = sizeof(atqa);
  MFRC522::StatusCode status = rfid_.PICC_WakeupA(atqa, &atqaSize);
  lastStatus_ = status;
  if (status == MFRC522::STATUS_ERROR) {
    lastErrorReg_ = rfid_.PCD_ReadRegister(MFRC522::ErrorReg);
  }
  ++polls_;
  bool found = (status == MFRC522::STATUS_OK || status == MFRC522::STATUS_COLLISION) && rfid_.PICC_ReadCardSerial();
  if (found) {
    ++hits_;
    uid = formatUid(rfid_.uid);
    rfid_.PICC_HaltA();
  }
  rfid_.PCD_AntennaOff();
  return found;
}

String NfcReader::takeDiagnostics() {
  if (ssPin_ < 0) {
    return "nfc off";
  }
  byte version = rfid_.PCD_ReadRegister(MFRC522::VersionReg);
  String result = "nfc " + String(hits_) + "/" + String(polls_) + " last " + String(MFRC522::GetStatusCodeName(lastStatus_));
  if (lastStatus_ == MFRC522::STATUS_ERROR) {
    result += " err 0x" + String(lastErrorReg_, HEX);
  }
  if (version == 0x00 || version == 0xFF) {
    result += " CHIP SILENT";
  }
  polls_ = 0;
  hits_ = 0;
  return result;
}

String NfcReader::formatUid(const MFRC522::Uid &uid) {
  static constexpr char HEX_DIGITS[] = "0123456789ABCDEF";
  String result;
  result.reserve(uid.size * 2);
  for (byte i = 0; i < uid.size; ++i) {
    result += HEX_DIGITS[(uid.uidByte[i] >> 4) & 0x0F];
    result += HEX_DIGITS[uid.uidByte[i] & 0x0F];
  }
  return result;
}
