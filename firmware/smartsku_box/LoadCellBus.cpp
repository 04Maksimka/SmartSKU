#include "LoadCellBus.h"

#include "AppConfig.h"

LoadCellBus::LoadCellBus(int8_t sckPin) : sckPin_(sckPin) {}

void LoadCellBus::attach(int8_t doutPin, LoadCell &cell) {
  if (doutPin >= 0) {
    channels_.push_back({doutPin, &cell, 0, false});
  }
}

void LoadCellBus::begin() {
  pinMode(sckPin_, OUTPUT);
  // SCK в LOW будит HX711 (HIGH дольше 60 мкс — сон)
  digitalWrite(sckPin_, LOW);
  unsigned long now = millis();
  for (auto &channel : channels_) {
    pinMode(channel.doutPin, INPUT);
    // Сразу после старта ждём каждый датчик, пока он не окажется мёртвым
    channel.lastReadyMs = now;
  }
}

bool LoadCellBus::channelAlive(const Channel &channel, unsigned long now) const {
  return now - channel.lastReadyMs < AppConfig::HX711_STALE_MS;
}

void LoadCellBus::update() {
  unsigned long now = millis();
  bool anyReady = false;
  bool allAliveReady = true;
  for (auto &channel : channels_) {
    // DOUT в LOW — преобразование готово; данные держатся, пока их не прочитают
    channel.ready = digitalRead(channel.doutPin) == LOW;
    if (channel.ready) {
      channel.lastReadyMs = now;
      anyReady = true;
    } else if (channelAlive(channel, now)) {
      allAliveReady = false;
    }
  }
  if (!anyReady) {
    firstReadyMs_ = 0;
    return;
  }
  if (firstReadyMs_ == 0) {
    firstReadyMs_ = now;
  }
  if (!allAliveReady && now - firstReadyMs_ < AppConfig::HX711_WAIT_MS) {
    return;
  }
  readReady();
  firstReadyMs_ = 0;
}

// Такты получают все датчики, но значение берётся только у тех, кто был готов до первого такта.
// Датчик, который стал готов посреди чтения, выдаст один испорченный отсчёт — это бывает только у сбоящего датчика
void LoadCellBus::readReady() {
  size_t count = channels_.size();
  std::vector<uint32_t> raw(count, 0);

  portENTER_CRITICAL(&mux_);
  for (uint8_t bit = 0; bit < 24; ++bit) {
    digitalWrite(sckPin_, HIGH);
    delayMicroseconds(1);
    for (size_t i = 0; i < count; ++i) {
      raw[i] = (raw[i] << 1) | digitalRead(channels_[i].doutPin);
    }
    digitalWrite(sckPin_, LOW);
    delayMicroseconds(1);
  }
  // 25-й такт: следующее преобразование — канал A, усиление 128
  digitalWrite(sckPin_, HIGH);
  delayMicroseconds(1);
  digitalWrite(sckPin_, LOW);
  portEXIT_CRITICAL(&mux_);

  for (size_t i = 0; i < count; ++i) {
    if (!channels_[i].ready) {
      continue;
    }
    // 24-битное число в дополнительном коде
    int32_t value = static_cast<int32_t>(raw[i] & 0x800000 ? raw[i] | 0xFF000000 : raw[i]);
    channels_[i].cell->addSample(value);
  }
}
