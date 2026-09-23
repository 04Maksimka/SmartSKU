#pragma once

#include <Arduino.h>

#include <cstring>

// Данные ячейки, которые живут в её NFC-метке и переезжают вместе с ней в любой слот любого бокса.
// Вес — в граммах: каждый слот настроен эталонной гирей
struct CellTag {
  // Вес пустой ячейки: задаётся настройкой весов (cell_tare)
  bool hasTare = false;
  float tare = 0;
  // Вес одной штуки: задаётся калибровкой
  bool hasPiece = false;
  float pieceWeight = 0;
};

// 16 байт — один блок MIFARE Classic или четыре страницы Ultralight:
// 0-1 «SK», 2 версия, 3 флаги (бит 0 — тара, бит 1 — вес штуки), 4-7 тара float, 8-11 вес штуки float,
// 12-13 резерв, 14-15 CRC-16/CCITT байт 0-13. Чистая или чужая метка читается как ячейка без данных
class CellTagCodec {
public:
  static constexpr size_t SIZE = 16;

  static void encode(const CellTag &tag, uint8_t *data) {
    memset(data, 0, SIZE);
    data[0] = MAGIC_0;
    data[1] = MAGIC_1;
    data[2] = VERSION;
    data[3] = (tag.hasTare ? FLAG_TARE : 0) | (tag.hasPiece ? FLAG_PIECE : 0);
    memcpy(data + 4, &tag.tare, sizeof(float));
    memcpy(data + 8, &tag.pieceWeight, sizeof(float));
    uint16_t crc = crc16(data, CRC_OFFSET);
    data[CRC_OFFSET] = crc >> 8;
    data[CRC_OFFSET + 1] = crc & 0xFF;
  }

  // false — в метке нет наших данных; tag тогда остаётся пустым
  static bool decode(const uint8_t *data, CellTag &tag) {
    tag = CellTag();
    if (data[0] != MAGIC_0 || data[1] != MAGIC_1 || data[2] != VERSION) {
      return false;
    }
    uint16_t crc = (static_cast<uint16_t>(data[CRC_OFFSET]) << 8) | data[CRC_OFFSET + 1];
    if (crc != crc16(data, CRC_OFFSET)) {
      return false;
    }
    tag.hasTare = data[3] & FLAG_TARE;
    tag.hasPiece = data[3] & FLAG_PIECE;
    memcpy(&tag.tare, data + 4, sizeof(float));
    memcpy(&tag.pieceWeight, data + 8, sizeof(float));
    return true;
  }

private:
  static constexpr uint8_t MAGIC_0 = 'S';
  static constexpr uint8_t MAGIC_1 = 'K';
  // Версия 1 хранила веса в отсчётах датчика — такие метки читаются как чистые
  static constexpr uint8_t VERSION = 2;
  static constexpr uint8_t FLAG_TARE = 0x01;
  static constexpr uint8_t FLAG_PIECE = 0x02;
  static constexpr size_t CRC_OFFSET = 14;

  static uint16_t crc16(const uint8_t *data, size_t length) {
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < length; ++i) {
      crc ^= static_cast<uint16_t>(data[i]) << 8;
      for (uint8_t bit = 0; bit < 8; ++bit) {
        crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      }
    }
    return crc;
  }
};
