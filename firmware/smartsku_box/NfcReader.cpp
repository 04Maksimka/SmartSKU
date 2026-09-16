#include "NfcReader.h"

#include "AppConfig.h"

NfcReader::NfcReader(int8_t ssPin, int8_t rstPin) : rfid_(ssPin, rstPin) {}

void NfcReader::begin(uint8_t lockerId) {
  lockerId_ = lockerId;
  rfid_.PCD_Init();
  byte version = rfid_.PCD_ReadRegister(MFRC522::VersionReg);
  // 0x00 и 0xFF — чип не отвечает по SPI (проводка, питание 3.3 В, SS/RST)
  chipFound_ = version != 0x00 && version != 0xFF;
  if (chipFound_) {
    Serial.printf("[nfc %u] RC522 firmware 0x%02X\n", lockerId_, version);
  } else {
    Serial.printf("[nfc %u] ERROR: RC522 not responding (version 0x%02X), check wiring\n", lockerId_, version);
  }
}

bool NfcReader::update() {
  unsigned long now = millis();
  if (now - lastPollMs_ < AppConfig::RFID_POLL_INTERVAL_MS) {
    return false;
  }
  lastPollMs_ = now;

  String seen;
  if (poll(seen)) {
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
  byte atqa[2];
  byte atqaSize = sizeof(atqa);
  MFRC522::StatusCode status = rfid_.PICC_WakeupA(atqa, &atqaSize);
  if (status != MFRC522::STATUS_OK && status != MFRC522::STATUS_COLLISION) {
    return false;
  }
  if (!rfid_.PICC_ReadCardSerial()) {
    return false;
  }
  uid = formatUid(rfid_.uid);
  rfid_.PICC_HaltA();
  return true;
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
