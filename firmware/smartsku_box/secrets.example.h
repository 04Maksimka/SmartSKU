#pragma once

// Шаблон. Скопируйте этот файл в secrets.h рядом с ним и впишите свои данные.
// secrets.h добавлен в .gitignore — пароль не попадёт в репозиторий.
struct Secrets {
  // Имя сети чувствительно к регистру. ESP32 не видит 5 ГГц, поэтому нужна 2.4 ГГц сеть
  static constexpr const char *WIFI_SSID = "SKOLTECH";

  // WPA2 Enterprise (вход по логину и паролю): заполните EAP_IDENTITY и EAP_USERNAME (обычно это одно и то же).
  // Для обычной сети с одним паролем (например, раздача с телефона) оставьте EAP_USERNAME пустым: "".
  static constexpr const char *EAP_IDENTITY = "your.login";
  static constexpr const char *EAP_USERNAME = "your.login";
  static constexpr const char *WIFI_PASSWORD = "your-password";

  // IP компьютера, на котором запущен mosquitto. Узнать на Mac: ipconfig getifaddr en0
  static constexpr const char *MQTT_HOST = "10.16.106.67";
};
