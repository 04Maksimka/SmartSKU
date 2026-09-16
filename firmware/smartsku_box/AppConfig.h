#pragma once

#include <Arduino.h>

// Железо одной умной ячейки. Пин -1 — компонент не подключён
struct LockerHardware {
  // true, если при нагрузке сырые показания HX711 уменьшаются (перепутаны провода A+/A-)
  bool invertLoad;
  int8_t hxDout;
  int8_t hxSck;
  int8_t displayClk;
  int8_t displayDio;
  int8_t rfidSs;
  int8_t rfidRst;
  int8_t ledRed;
  int8_t ledGreen;
};

// Несекретные настройки прошивки. Логин/пароль Wi-Fi и адрес брокера лежат в secrets.h
struct AppConfig {
  static constexpr unsigned long SERIAL_BAUD = 115200;
  // Встроенный светодиод платы: мигает, пока нет связи с брокером; горит, когда бокс работает
  static constexpr int STATUS_LED_PIN = 2;
  static constexpr unsigned long STATUS_BLINK_FAST_MS = 150;
  static constexpr unsigned long STATUS_BLINK_SLOW_MS = 600;

  static constexpr unsigned long WIFI_CONNECT_TIMEOUT_MS = 30000;
  static constexpr int WIFI_SCAN_PRINT_LIMIT = 25;

  static constexpr uint16_t MQTT_PORT = 1883;
  static constexpr uint16_t MQTT_KEEPALIVE_S = 30;
  static constexpr uint16_t MQTT_SOCKET_TIMEOUT_S = 5;
  static constexpr uint16_t MQTT_BUFFER_SIZE = 1024;
  static constexpr unsigned long MQTT_RECONNECT_INTERVAL_MS = 3000;
  static constexpr const char *TOPIC_PREFIX = "smartsku";

  // Повтор запроса box_id, пока бэкенд не ответил
  static constexpr unsigned long PROVISION_RETRY_MS = 5000;
  // Период отправки box_data
  static constexpr unsigned long TELEMETRY_INTERVAL_MS = 500;
  // Период отладочной строки с показаниями в Serial (включается командой v)
  static constexpr unsigned long DEBUG_LOG_INTERVAL_MS = 1000;

  // Общая SPI-шина RC522; у каждого считывателя свои SS и RST
  static constexpr int8_t RFID_SCK = 22;
  static constexpr int8_t RFID_MISO = 21;
  static constexpr int8_t RFID_MOSI = 23;
  static constexpr unsigned long RFID_POLL_INTERVAL_MS = 100;
  // Столько опросов подряд без метки — и ячейка считается вынутой (защита от случайных пропусков)
  static constexpr uint8_t RFID_MISSES_TO_REMOVE = 3;

  static constexpr uint8_t HX711_GAIN = 128;
  // Показания HX711 усредняются по окну такой длины (при 10 Гц это ~5 отсчётов)
  static constexpr unsigned long MEASURE_WINDOW_MS = 500;
  // Столько пустых окон подряд — и HX711 считается отвалившимся (одно пустое окно бывает, когда цикл
  // блокируется, например при сканировании Wi-Fi на старте)
  static constexpr uint8_t HX711_MAX_EMPTY_WINDOWS = 3;
  // Ноль усредняется по нескольким окнам: он хранится долго, и ошибка в нём сдвигает все показания
  static constexpr uint8_t TARE_WINDOWS = 4;

  // Вес — в условных единицах: сырые отсчёты HX711 за вычетом нуля (пустой ячейки). Перевод в граммы не нужен:
  // количество = вес / вес штуки, а вес штуки меряется тем же датчиком.
  // Пороги ниже — тоже в отсчётах; подобрать по шуму конкретного датчика (команда v, колонка net)
  //
  // Шум: окна, которые отличаются от отправленного веса меньше чем на NOISE_UNITS, не меняют weight в box_data
  // (если при этом не изменилось число штук)
  static constexpr double NOISE_UNITS = 150;
  // Калибровка штуки не принимает ячейку легче этого — считается, что её вставили пустой
  static constexpr double EMPTY_UNITS = 500;
  // После вставки ячейки вес «плывёт»: ячейка не попадает в телеметрию (и не калибруется), пока не будет
  // столько окон подряд с разбросом меньше NOISE_UNITS, но не дольше SETTLE_TIMEOUT_MS
  static constexpr uint8_t STABLE_WINDOWS = 3;
  static constexpr unsigned long SETTLE_TIMEOUT_MS = 5000;

  static constexpr uint8_t DISPLAY_BRIGHTNESS = 3;

  static constexpr const char *STORAGE_NAMESPACE = "smartsku";

  static constexpr uint8_t LOCKER_COUNT = 1;
  // Индекс в массиве = locker_id. Ячейка 0 — схема из tenzo_test.ino (ветка master)
  static constexpr LockerHardware LOCKERS[LOCKER_COUNT] = {
    {.invertLoad = false,
     .hxDout = 36, .hxSck = 32, .displayClk = 33, .displayDio = 25, .rfidSs = 19, .rfidRst = 16, .ledRed = -1, .ledGreen = -1},
  };
};
