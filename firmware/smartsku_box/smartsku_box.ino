// Прошивка бокса SmartSKU: HX711 + RC522 + TM1637 на каждую ячейку, связь с бэкендом по MQTT. Логика — в BoxApp.
// Перед сборкой: скопируйте secrets.example.h в secrets.h и впишите логин/пароль Wi-Fi и IP брокера.
// Библиотеки: PubSubClient, ArduinoJson, HX711 (bogde), MFRC522 (miguelbalboa), GyverTM1637.
// Пины и настройки — в AppConfig.h. Сервисные команды (тара, калибровка весов) — в Serial Monitor на 115200, 'h' — справка.

#include "BoxApp.h"

BoxApp app;

void setup() {
  app.begin();
}

void loop() {
  app.update();
}
