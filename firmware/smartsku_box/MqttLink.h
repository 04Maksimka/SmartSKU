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
  // statusTopic пустой — без Last Will и статуса online
  void configureSession(const String &statusTopic, const std::vector<String> &subscriptions);
  void update(bool networkReady);
  bool connected();
  bool publish(const String &topic, const String &payload, bool retained = false);

private:
  void connect();

  const String clientId_;
  String statusTopic_;
  std::vector<String> subscriptions_;
  WiFiClient socket_;
  PubSubClient client_;
  MessageHandler handler_;
  bool hasAttempted_ = false;
  unsigned long lastAttemptMs_ = 0;
};
