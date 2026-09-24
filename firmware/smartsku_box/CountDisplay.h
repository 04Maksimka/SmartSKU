#pragma once

#include <Arduino.h>
#include <GyverTM1637.h>

// 4-разрядный TM1637: количество штук или служебные надписи. Перерисовывает только при изменении
class CountDisplay {
public:
  static constexpr int MAX_NUMBER = 9999;
  // Число после буквы задания сборки: три разряда
  static constexpr int MAX_TASK_NUMBER = 999;
  static constexpr uint8_t LETTER_TAKE = 0x78;  // "t" — взять
  static constexpr uint8_t LETTER_PUT = 0x73;   // "P" — положить обратно

  CountDisplay(int8_t clkPin, int8_t dioPin) : display_(clkPin, dioPin) {}

  void begin(uint8_t brightness) {
    display_.clear();
    display_.brightness(brightness);
    display_.point(false);
    showDashes();
  }

  void showNumber(int number) {
    if (number > MAX_NUMBER) {
      showBytes(0x00, 0x3F, 0x71, 0x38);  // " OFL"
      return;
    }
    if (number < 0) {
      showError();
      return;
    }
    if (shown_ == Shown::Number && number_ == number) {
      return;
    }
    shown_ = Shown::Number;
    number_ = number;
    display_.displayInt(number);
  }

  // Сборка: буква задания и число справа, "t 20", "P  3"; больше 999 — "tOFL"
  void showTask(uint8_t letter, int number) {
    if (number > MAX_TASK_NUMBER || number < 0) {
      showBytes(letter, 0x3F, 0x71, 0x38);
      return;
    }
    uint8_t digits[3] = {0x00, 0x00, 0x00};
    for (int index = 2; index >= 0; --index) {
      digits[index] = DIGITS[number % 10];
      number /= 10;
      if (number == 0) {
        break;
      }
    }
    showBytes(letter, digits[0], digits[1], digits[2]);
  }

  // Сборка: слоту нечего делать — погашен
  void showBlank() {
    showBytes(0x00, 0x00, 0x00, 0x00);
  }

  void showDashes() {
    showBytes(0x40, 0x40, 0x40, 0x40);  // "----"
  }

  void showError() {
    showBytes(0x00, 0x79, 0x50, 0x50);  // " Err"
  }

  // Подсказки настройки весов и калибровки, те же надписи описаны на фронте
  void showPullOut() {
    showBytes(0x3F, 0x3E, 0x78, 0x00);  // "OUt "
  }

  void showInsert() {
    showBytes(0x00, 0x06, 0x54, 0x00);  // " In "
  }

  void showHold() {
    showBytes(0x76, 0x3F, 0x38, 0x5E);  // "HOLd"
  }

  void showDone() {
    showBytes(0x5E, 0x5C, 0x54, 0x79);  // "donE"
  }

private:
  enum class Shown { Nothing, Number, Bytes };

  static constexpr uint8_t DIGITS[10] = {0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F};

  void showBytes(uint8_t a, uint8_t b, uint8_t c, uint8_t d) {
    uint32_t packed = (static_cast<uint32_t>(a) << 24) | (b << 16) | (c << 8) | d;
    if (shown_ == Shown::Bytes && bytes_ == packed) {
      return;
    }
    shown_ = Shown::Bytes;
    bytes_ = packed;
    display_.displayByte(a, b, c, d);
  }

  GyverTM1637 display_;
  Shown shown_ = Shown::Nothing;
  int number_ = 0;
  uint32_t bytes_ = 0;
};
