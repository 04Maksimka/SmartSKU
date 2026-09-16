#pragma once

#include <Arduino.h>
#include <MFRC522.h>

// Считыватель RC522 одной ячейки. В отличие от PICC_IsNewCardPresent замечает и исчезновение метки:
// каждый опрос будит метку командой WUPA (она отвечает, даже если после прошлого чтения ушла в HALT)
class NfcReader {
public:
  NfcReader(int8_t ssPin, int8_t rstPin);

  // SPI.begin() должен быть вызван заранее: шина общая для всех считывателей
  void begin(uint8_t lockerId);
  // true, если сменилось состояние: метку вставили, вынули или заменили другой
  bool update();

  bool present() const {
    return present_;
  }
  // UID в hex без разделителей, например "04A1B2C3"; пустая строка, если метки нет
  const String &uid() const {
    return uid_;
  }
  bool chipFound() const {
    return chipFound_;
  }

private:
  bool poll(String &uid);
  static String formatUid(const MFRC522::Uid &uid);

  MFRC522 rfid_;
  uint8_t lockerId_ = 0;
  bool chipFound_ = false;
  bool present_ = false;
  String uid_;
  uint8_t misses_ = 0;
  unsigned long lastPollMs_ = 0;
};
