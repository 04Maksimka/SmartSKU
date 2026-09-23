// Прошивка бокса SmartSKU: HX711 + RC522 + TM1637 на каждую ячейку, связь с бэкендом по MQTT. Логика — в BoxApp.
// Сеть и сервер задаются с фронта по Bluetooth (кнопка «Подключить бокс»), secrets.h не обязателен.
// Плата: ESP32 Dev Module, Partition Scheme: Huge APP (прошивка с Bluetooth не влезает в 1.3 МБ).
// Данные ячеек (тара, вес штуки) хранятся в их NFC-метках (MIFARE Classic или Ultralight), см. CellTag.h.
// Библиотеки: PubSubClient, ArduinoJson, MFRC522 (miguelbalboa), GyverTM1637; BLE — из ядра ESP32.
// Пины и настройки — в AppConfig.h. Сервисные команды (тара, калибровка весов) — в Serial Monitor на 115200, 'h' — справка.

#include "BoxApp.h"

BoxApp app;

void setup() {
  app.begin();
}

void loop() {
  app.update();
}
