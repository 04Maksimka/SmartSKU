#pragma once

// Необязательный шаблон для разработки. Сеть и сервер задаются с фронта по Bluetooth и хранятся в памяти бокса.
// Если скопировать этот файл в secrets.h (он в .gitignore), бокс при первом включении возьмёт настройки отсюда —
// пока в памяти не сохранены другие.
struct Secrets {
  // Имя сети чувствительно к регистру. ESP32 не видит 5 ГГц, поэтому нужна 2.4 ГГц сеть
  static constexpr const char *WIFI_SSID = "SKOLTECH";

  // WPA2 Enterprise (вход по логину и паролю): впишите логин. Для обычной сети с одним паролем оставьте "".
  static constexpr const char *EAP_USERNAME = "your.login";
  static constexpr const char *WIFI_PASSWORD = "your-password";

  // IP или имя компьютера (например my-mac.local), на котором запущен mosquitto. IP на Mac: ipconfig getifaddr en0
  static constexpr const char *MQTT_HOST = "10.16.106.67";
};
