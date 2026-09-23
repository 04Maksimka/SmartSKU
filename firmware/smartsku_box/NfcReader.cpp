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
  bool found = select(seen);
  // Без метки исправный RC522 отвечает таймаутом; ошибка раз за разом — чип сбился, настраиваем заново
  errorsInRow_ = lastStatus_ == MFRC522::STATUS_ERROR ? errorsInRow_ + 1 : 0;
  if (errorsInRow_ >= AppConfig::RFID_ERRORS_TO_REINIT) {
    Serial.printf("[nfc %u] %u communication errors in a row (ErrorReg 0x%02X), reinitializing\n", lockerId_, errorsInRow_, lastErrorReg_);
    errorsInRow_ = 0;
    init();
  }

  bool changed = false;
  if (found) {
    misses_ = 0;
    if (!present_ || seen != uid_) {
      if (writePending_) {
        finishWrite(WriteResult::Failed);
      }
      present_ = true;
      uid_ = seen;
      tag_ = CellTag();
      tagState_ = TagState::Reading;
      readAttempts_ = 0;
      MFRC522::PICC_Type type = MFRC522::PICC_GetType(rfid_.uid.sak);
      tagKind_ = type == MFRC522::PICC_TYPE_MIFARE_MINI || type == MFRC522::PICC_TYPE_MIFARE_1K || type == MFRC522::PICC_TYPE_MIFARE_4K
                   ? TagKind::Classic
                   : (type == MFRC522::PICC_TYPE_MIFARE_UL ? TagKind::Ultralight : TagKind::Other);
      Serial.printf("[nfc %u] cell inserted: %s (%s)\n", lockerId_, uid_.c_str(), String(MFRC522::PICC_GetTypeName(type)).c_str());
      changed = true;
    }
    if (tagState_ == TagState::Reading) {
      readTag();
    }
    if (writePending_ && tagState_ == TagState::Ready) {
      writeTag();
    }
    release(true);
    return changed;
  }
  release(false);

  if (!present_ || ++misses_ < AppConfig::RFID_MISSES_TO_REMOVE) {
    return false;
  }
  Serial.printf("[nfc %u] cell removed: %s\n", lockerId_, uid_.c_str());
  present_ = false;
  uid_ = "";
  misses_ = 0;
  tag_ = CellTag();
  tagState_ = TagState::NoCell;
  if (writePending_) {
    finishWrite(WriteResult::Failed);
  }
  return true;
}

void NfcReader::requestWrite(const CellTag &tag) {
  pendingTag_ = tag;
  writePending_ = true;
  writeAttempts_ = 0;
  writeResult_ = WriteResult::None;
}

NfcReader::WriteResult NfcReader::takeWriteResult() {
  WriteResult result = writeResult_;
  writeResult_ = WriteResult::None;
  return result;
}

void NfcReader::finishWrite(WriteResult result) {
  writePending_ = false;
  writeResult_ = result;
}

bool NfcReader::select(String &uid) {
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
  }
  return found;
}

// HALT до выключения шифрования: так метка засыпает и после аутентификации MIFARE Classic.
// Без метки HALT не шлём: команда ждала бы ответа до таймаута
void NfcReader::release(bool selected) {
  if (selected) {
    rfid_.PICC_HaltA();
    rfid_.PCD_StopCrypto1();
  }
  rfid_.PCD_AntennaOff();
}

void NfcReader::readTag() {
  if (tagKind_ == TagKind::Other) {
    tagState_ = TagState::Unsupported;
    Serial.printf("[nfc %u] ERROR: tag type is not supported, cell data cannot be stored\n", lockerId_);
    return;
  }
  uint8_t data[CellTagCodec::SIZE];
  if (!readBlock(data)) {
    if (++readAttempts_ >= AppConfig::TAG_READ_ATTEMPTS) {
      tagState_ = TagState::Unsupported;
      Serial.printf("[nfc %u] ERROR: tag data cannot be read (%s)\n", lockerId_, String(MFRC522::GetStatusCodeName(lastStatus_)).c_str());
    }
    return;
  }
  tagState_ = TagState::Ready;
  if (CellTagCodec::decode(data, tag_)) {
    Serial.printf(
      "[nfc %u] tag: tare %s, piece %s\n", lockerId_, tag_.hasTare ? String(tag_.tare, 1).c_str() : "-",
      tag_.hasPiece ? String(tag_.pieceWeight, 2).c_str() : "-"
    );
  } else {
    Serial.printf("[nfc %u] tag has no cell data yet\n", lockerId_);
  }
}

void NfcReader::writeTag() {
  uint8_t data[CellTagCodec::SIZE];
  CellTagCodec::encode(pendingTag_, data);
  uint8_t check[CellTagCodec::SIZE];
  // Чтение после записи: метку могли выдернуть посреди записи
  if (writeBlock(data) && readBlock(check) && memcmp(data, check, CellTagCodec::SIZE) == 0) {
    tag_ = pendingTag_;
    finishWrite(WriteResult::Done);
    Serial.printf("[nfc %u] tag written\n", lockerId_);
    return;
  }
  if (++writeAttempts_ >= AppConfig::TAG_WRITE_ATTEMPTS) {
    Serial.printf("[nfc %u] ERROR: tag write failed (%s)\n", lockerId_, String(MFRC522::GetStatusCodeName(lastStatus_)).c_str());
    finishWrite(WriteResult::Failed);
  }
}

bool NfcReader::authenticate() {
  MFRC522::MIFARE_Key key;
  memset(key.keyByte, 0xFF, sizeof(key.keyByte));
  lastStatus_ = rfid_.PCD_Authenticate(MFRC522::PICC_CMD_MF_AUTH_KEY_A, AppConfig::TAG_CLASSIC_BLOCK, &key, &rfid_.uid);
  return lastStatus_ == MFRC522::STATUS_OK;
}

bool NfcReader::readBlock(uint8_t *data) {
  if (tagKind_ == TagKind::Classic && !authenticate()) {
    return false;
  }
  // MIFARE_Read отдаёт 16 байт и CRC: у Classic — блок, у Ultralight — четыре страницы подряд
  byte buffer[18];
  byte size = sizeof(buffer);
  byte address = tagKind_ == TagKind::Classic ? AppConfig::TAG_CLASSIC_BLOCK : AppConfig::TAG_ULTRALIGHT_PAGE;
  lastStatus_ = rfid_.MIFARE_Read(address, buffer, &size);
  if (lastStatus_ != MFRC522::STATUS_OK) {
    return false;
  }
  memcpy(data, buffer, CellTagCodec::SIZE);
  return true;
}

bool NfcReader::writeBlock(const uint8_t *data) {
  byte buffer[CellTagCodec::SIZE];
  memcpy(buffer, data, sizeof(buffer));
  if (tagKind_ == TagKind::Classic) {
    if (!authenticate()) {
      return false;
    }
    lastStatus_ = rfid_.MIFARE_Write(AppConfig::TAG_CLASSIC_BLOCK, buffer, sizeof(buffer));
    return lastStatus_ == MFRC522::STATUS_OK;
  }
  for (uint8_t page = 0; page < CellTagCodec::SIZE / 4; ++page) {
    lastStatus_ = rfid_.MIFARE_Ultralight_Write(AppConfig::TAG_ULTRALIGHT_PAGE + page, buffer + page * 4, 4);
    if (lastStatus_ != MFRC522::STATUS_OK) {
      return false;
    }
  }
  return true;
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
