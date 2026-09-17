#pragma once

#include <Arduino.h>
#include <MFRC522.h>

// Считыватель RC522 одной ячейки. В отличие от PICC_IsNewCardPresent замечает и исчезновение метки:
// каждый опрос будит метку командой WUPA (она отвечает, даже если после прошлого чтения ушла в HALT).
// Антенна включена только во время опроса: считыватели стоят рядом и иначе мешают друг другу
class NfcReader {
public:
  explicit NfcReader(int8_t ssPin);

  // До SPI.begin() и до begin() любого считывателя: SS всех чипов в HIGH, иначе неинициализированный чип
  // с плавающим SS отвечает на шине вместе с тем, кого настраивают
  void deselect();
  // Жёсткий сброс всех считывателей на общем RST. RC522 не сбрасываются вместе с ESP32 и могут остаться в состоянии
  // от прошлой прошивки; после сброса RST держится в HIGH (библиотека оставила бы линию плавать)
  static void hardResetAll(int8_t rstPin);
  // SPI.begin() должен быть вызван заранее: шина общая для всех считывателей
  void begin(uint8_t lockerId);
  // Один опрос; расписание (по одному считывателю за раз) задаёт BoxApp.
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
  // Диагностика для строки показаний: опросы и находки с прошлого вызова, код последнего опроса,
  // отвечает ли чип сейчас. Счётчики сбрасываются
  String takeDiagnostics();

private:
  bool poll(String &uid);
  void init();
  static String formatUid(const MFRC522::Uid &uid);

  const int8_t ssPin_;
  MFRC522 rfid_;
  uint8_t lockerId_ = 0;
  bool chipFound_ = false;
  bool present_ = false;
  String uid_;
  uint8_t misses_ = 0;
  uint16_t polls_ = 0;
  uint16_t hits_ = 0;
  MFRC522::StatusCode lastStatus_ = MFRC522::STATUS_OK;
  byte lastErrorReg_ = 0;
  uint8_t errorsInRow_ = 0;
};
