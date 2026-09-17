#pragma once

#include <Arduino.h>
#include <PubSubClient.h>
#include <WiFi.h>

#include <functional>
#include <vector>

// Подключение к MQTT-брокеру: переподключение, статус online/offline (Last Will), подписки.
// Сессию (Last Will и подписки) можно сменить на лету: после выдачи box_id бокс переподключается уже под ним.
class MqttLink {
public:
  using MessageHandler = std::function<void(const String &topic, const String &payload)>;

  explicit MqttLink(const String &clientId);

  void begin(MessageHandler handler);
  // Адрес брокера: IP или имя; имя вида host.local ищется через mDNS при каждом подключении
  void setServer(const String &host, uint16_t port);
  const String &host() const {
    return host_;
  }
  // Код PubSubClient последней неудачной попытки (0 — ошибок не было)
  int lastError() const {
    return lastError_;
  }
  unsigned long failedAttempts() const {
    return failedAttempts_;
  }
  // statusTopic пустой — без Last Will и статуса online
  void configureSession(const String &statusTopic, const std::vector<String> &subscriptions);
  void update(bool networkReady);
  bool connected();
  bool publish(const String &topic, const String &payload, bool retained = false);

private:
  void connect();
  bool resolveServer();

  const String clientId_;
  String host_;
  uint16_t port_ = 0;
  bool mdnsStarted_ = false;
  int lastError_ = 0;
  unsigned long failedAttempts_ = 0;
  String statusTopic_;
  std::vector<String> subscriptions_;
  WiFiClient socket_;
  PubSubClient client_;
  MessageHandler handler_;
  bool hasAttempted_ = false;
  unsigned long lastAttemptMs_ = 0;
};
