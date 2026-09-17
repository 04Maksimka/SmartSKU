#pragma once

#include <Arduino.h>

// Железо одной умной ячейки. Общие для всех ячеек линии (SCK HX711, CLK дисплеев, RST и SPI считывателей) —
// в AppConfig. Пин -1 — компонент не подключён
struct LockerHardware {
  // true, если при нагрузке сырые показания HX711 уменьшаются (перепутаны провода A+/A-)
  bool invertLoad;
  int8_t hxDout;
  int8_t displayDio;
  int8_t rfidSs;
  int8_t ledRed;
  int8_t ledGreen;
};

// Настройки прошивки. Сеть и адрес брокера задаются с фронта по Bluetooth и хранятся в NVS (см. NetworkSettings)
struct AppConfig {
  // Показывается на фронте при подключении бокса
  static constexpr const char *FIRMWARE_VERSION = "0.5.0";
  static constexpr unsigned long SERIAL_BAUD = 115200;
  // Встроенный светодиод платы: мигает, пока нет связи с брокером; горит, когда бокс работает
  static constexpr int STATUS_LED_PIN = 2;
  static constexpr unsigned long STATUS_BLINK_FAST_MS = 150;
  static constexpr unsigned long STATUS_BLINK_SLOW_MS = 600;
  // Режим подключения: короткая вспышка раз в секунду
  static constexpr unsigned long STATUS_SETUP_PERIOD_MS = 1000;
  static constexpr unsigned long STATUS_SETUP_FLASH_MS = 100;

  // Режим подключения по Bluetooth: удержание кнопки BOOT (GPIO0) на работающей плате.
  // Держать BOOT при подаче питания нельзя — плата уйдёт в режим прошивки
  static constexpr int SETUP_BUTTON_PIN = 0;
  static constexpr unsigned long SETUP_HOLD_MS = 3000;
  // Сколько бокс виден по Bluetooth, если к нему никто не подключился
  static constexpr unsigned long SETUP_WINDOW_MS = 5UL * 60 * 1000;
  // После регистрации канал ещё открыт, чтобы фронт успел получить статус
  static constexpr unsigned long SETUP_LINGER_MS = 15000;
  static constexpr const char *BLE_NAME_PREFIX = "SmartSKU-";
  // GATT-сервис настройки: построчный JSON, как UART. Те же UUID — во frontend/src/app/ble-box-link.ts
  static constexpr const char *BLE_SERVICE_UUID = "6f1c0001-8c5b-4f5e-9a57-5b1e2a8d0c11";
  static constexpr const char *BLE_RX_UUID = "6f1c0002-8c5b-4f5e-9a57-5b1e2a8d0c11";
  static constexpr const char *BLE_TX_UUID = "6f1c0003-8c5b-4f5e-9a57-5b1e2a8d0c11";
  static constexpr size_t BLE_MAX_REQUEST = 1024;
  static constexpr uint16_t BLE_MTU = 247;
  // Пауза между кусками ответа, чтобы стек Bluetooth не терял уведомления
  static constexpr unsigned long BLE_CHUNK_DELAY_MS = 15;
  static constexpr size_t WIFI_SCAN_LIMIT = 20;

  static constexpr unsigned long WIFI_CONNECT_TIMEOUT_MS = 30000;
  static constexpr unsigned long WIFI_DISCONNECT_WAIT_MS = 2000;

  static constexpr uint16_t DEFAULT_MQTT_PORT = 1883;
  static constexpr unsigned long MDNS_QUERY_TIMEOUT_MS = 2000;
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

  // Общая SPI-шина и общий RST у всех RC522; у каждого считывателя свой SS
  static constexpr int8_t RFID_SCK = 22;
  static constexpr int8_t RFID_MISO = 21;
  static constexpr int8_t RFID_MOSI = 23;
  static constexpr int8_t RFID_RST = 16;
  static constexpr unsigned long RFID_RESET_PULSE_MS = 2;
  static constexpr unsigned long RFID_RESET_STARTUP_MS = 50;
  // Считыватели опрашиваются по очереди, по одному за раз: антенна включается только на время опроса, чтобы
  // соседние считыватели не мешали друг другу. Опрос без метки блокирует цикл на ~30 мс (таймаут RC522),
  // поэтому между опросами — пауза. Каждый считыватель опрашивается раз в LOCKER_COUNT * интервал
  static constexpr unsigned long RFID_POLL_INTERVAL_MS = 50;
  // Метке нужно время, чтобы получить питание от только что включённого поля
  static constexpr unsigned long RFID_ANTENNA_SETTLE_MS = 5;
  // Столько опросов подряд без метки — и ячейка считается вынутой (защита от случайных пропусков)
  static constexpr uint8_t RFID_MISSES_TO_REMOVE = 3;
  // Столько опросов подряд с ошибкой связи (не таймаутом) — и считыватель инициализируется заново (~10 с)
  static constexpr uint8_t RFID_ERRORS_TO_REINIT = 50;

  // Общий CLK у всех TM1637; у каждого дисплея свой DIO
  static constexpr int8_t DISPLAY_CLK = 33;

  // Общий SCK у всех HX711: один такт читает все датчики сразу, поэтому они опрашиваются вместе (LoadCellBus).
  // Канал A, усиление 128 — 25 тактов на чтение
  static constexpr int8_t HX711_SCK = 32;
  // Чтение ждёт, пока данные готовы у всех живых датчиков (при 10 Гц — до 100 мс), но не дольше этого
  static constexpr unsigned long HX711_WAIT_MS = 200;
  // Датчик, который столько не выдавал данных, больше не ждём (сломан или не подключён); вернётся сам,
  // когда снова начнёт отвечать
  static constexpr unsigned long HX711_STALE_MS = 1000;
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
  static constexpr double NOISE_UNITS = 400;
  // Калибровка штуки не принимает ячейку легче этого — считается, что её вставили пустой
  static constexpr double EMPTY_UNITS = 1000;
  // После вставки ячейки вес «плывёт»: ячейка не попадает в телеметрию (и не калибруется), пока не будет
  // столько окон подряд с разбросом меньше NOISE_UNITS, но не дольше SETTLE_TIMEOUT_MS
  static constexpr uint8_t STABLE_WINDOWS = 3;
  static constexpr unsigned long SETTLE_TIMEOUT_MS = 5000;

  static constexpr uint8_t DISPLAY_BRIGHTNESS = 3;

  static constexpr const char *STORAGE_NAMESPACE = "smartsku";

  static constexpr uint8_t LOCKER_COUNT = 4;
  // Индекс в массиве = locker_id (лоток 1 на плате — locker 0). Схема из four_tray_hardware_test.ino.
  // Светодиоды висят на расширителе PCF8575 (I2C: SDA 4, SCL 15, адрес 0x20) и пока не используются:
  // после включения его выходы в HIGH, светодиоды с общим анодом не горят
  static constexpr LockerHardware LOCKERS[LOCKER_COUNT] = {
    {.invertLoad = false, .hxDout = 36, .displayDio = 25, .rfidSs = 19, .ledRed = -1, .ledGreen = -1},
    {.invertLoad = false, .hxDout = 39, .displayDio = 26, .rfidSs = 18, .ledRed = -1, .ledGreen = -1},
    {.invertLoad = false, .hxDout = 34, .displayDio = 27, .rfidSs = 5, .ledRed = -1, .ledGreen = -1},
    {.invertLoad = false, .hxDout = 35, .displayDio = 14, .rfidSs = 17, .ledRed = -1, .ledGreen = -1},
  };
};
