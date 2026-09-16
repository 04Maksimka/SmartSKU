#pragma once

#include <Arduino.h>

// Двухцветный индикатор ячейки (led_color: red / green / none). Пин -1 — светодиод не подключён
class IndicatorLed {
public:
  IndicatorLed(int8_t redPin, int8_t greenPin) : redPin_(redPin), greenPin_(greenPin) {}

  void begin() {
    setup(redPin_);
    setup(greenPin_);
  }

  // false — неизвестный цвет
  bool apply(const String &color) {
    if (color != "red" && color != "green" && color != "none") {
      return false;
    }
    write(redPin_, color == "red");
    write(greenPin_, color == "green");
    return true;
  }

private:
  static void setup(int8_t pin) {
    if (pin >= 0) {
      pinMode(pin, OUTPUT);
      digitalWrite(pin, LOW);
    }
  }

  static void write(int8_t pin, bool on) {
    if (pin >= 0) {
      digitalWrite(pin, on ? HIGH : LOW);
    }
  }

  const int8_t redPin_;
  const int8_t greenPin_;
};
