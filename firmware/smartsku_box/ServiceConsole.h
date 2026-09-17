#pragma once

#include <Arduino.h>

// Сервисная команда из Serial Monitor (наладка на месте, бэкенду не нужна)
struct ConsoleCommand {
  enum class Type { None, Tare, Status, Verbose, ForgetBoxId, Setup, Help, Invalid };

  Type type = Type::None;
  uint8_t lockerId = 0;
};

// Читает строки из Serial (любой конец строки или пауза 300 мс) и разбирает их:
//   t [locker]           — ноль по пустой вставленной ячейке
//   s                    — состояние бокса и ячеек
//   v                    — вкл/выкл строку показаний раз в секунду
//   forget               — забыть box_id и перезагрузиться (бокс заново зарегистрируется)
//   setup                — режим подключения по Bluetooth (то же, что удержание BOOT)
class ServiceConsole {
public:
  static constexpr size_t MAX_LINE = 100;
  static constexpr unsigned long LINE_IDLE_MS = 300;

  void begin();
  ConsoleCommand poll();
  static void printHelp();

private:
  static ConsoleCommand parse(String line);
  static bool parseLocker(const String &text, uint8_t &lockerId);

  String line_;
  bool overflow_ = false;
  unsigned long lastCharMs_ = 0;
};
