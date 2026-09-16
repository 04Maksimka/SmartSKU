#pragma once

#include <Arduino.h>

// Светодиод статуса: выключен, горит или мигает с заданным периодом; мигание неблокирующее, через millis()
class StatusLed {
public:
  enum class Mode { Off, On, Blink };

  explicit StatusLed(int pin) : pin_(pin) {}

  void begin() {
    pinMode(pin_, OUTPUT);
    digitalWrite(pin_, LOW);
  }

  void setMode(Mode mode, unsigned long blinkIntervalMs = 0) {
    mode_ = mode;
    blinkIntervalMs_ = blinkIntervalMs;
  }

  void update() {
    if (mode_ != Mode::Blink) {
      write(mode_ == Mode::On ? HIGH : LOW);
      return;
    }
    unsigned long now = millis();
    if (now - lastToggleMs_ >= blinkIntervalMs_) {
      lastToggleMs_ = now;
      write(level_ == LOW ? HIGH : LOW);
    }
  }

private:
  void write(int level) {
    if (level != level_) {
      level_ = level;
      digitalWrite(pin_, level_);
    }
  }

  const int pin_;
  Mode mode_ = Mode::Off;
  unsigned long blinkIntervalMs_ = 0;
  int level_ = LOW;
  unsigned long lastToggleMs_ = 0;
};
