#pragma once

#include <Arduino.h>

// Кнопка, которая срабатывает при удержании. Замыкает пин на землю (как BOOT на GPIO0 у DevKit)
class HoldButton {
public:
  HoldButton(int pin, unsigned long holdMs) : pin_(pin), holdMs_(holdMs) {}

  void begin() {
    pinMode(pin_, INPUT_PULLUP);
  }

  // true один раз за нажатие, когда кнопку продержали holdMs
  bool update() {
    bool pressed = digitalRead(pin_) == LOW;
    unsigned long now = millis();
    if (!pressed) {
      pressedSinceMs_ = 0;
      fired_ = false;
      return false;
    }
    if (pressedSinceMs_ == 0) {
      pressedSinceMs_ = now == 0 ? 1 : now;
    }
    if (!fired_ && now - pressedSinceMs_ >= holdMs_) {
      fired_ = true;
      return true;
    }
    return false;
  }

private:
  const int pin_;
  const unsigned long holdMs_;
  unsigned long pressedSinceMs_ = 0;
  bool fired_ = false;
};
