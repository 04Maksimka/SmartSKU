#pragma once

#include <Arduino.h>

#include <vector>

#include "LoadCell.h"

// Несколько HX711 на общем SCK. Такт SCK сдвигает данные сразу во всех датчиках, поэтому читать их по одному нельзя:
// чтение одного съело бы или испортило данные остальных. Шина ждёт, пока данные готовы у всех живых датчиков,
// и читает их за одни 25 тактов (канал A, усиление 128), как four_tray_hardware_test.ino.
// Датчик, который долго не отвечает (DOUT всё время HIGH), перестаёт задерживать остальные: его значение
// в таком чтении отбрасывается, а его LoadCell через несколько пустых окон сообщает об ошибке
class LoadCellBus {
public:
  explicit LoadCellBus(int8_t sckPin);

  // Подключить канал до begin(); пин -1 — датчика нет, канал не подключается
  void attach(int8_t doutPin, LoadCell &cell);
  void begin();
  // Вызывать каждый цикл: если пора, читает датчики и передаёт отсчёты их LoadCell
  void update();

private:
  struct Channel {
    int8_t doutPin;
    LoadCell *cell;
    unsigned long lastReadyMs;
    bool ready;
  };

  bool channelAlive(const Channel &channel, unsigned long now) const;
  void readReady();

  const int8_t sckPin_;
  std::vector<Channel> channels_;
  // Когда впервые увидели готовые данные у какого-то датчика; 0 — никто не готов
  unsigned long firstReadyMs_ = 0;
  portMUX_TYPE mux_ = portMUX_INITIALIZER_UNLOCKED;
};
