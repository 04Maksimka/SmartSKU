#include "MqttLink.h"

#include "AppConfig.h"
#include "secrets.h"

MqttLink::MqttLink(const String &clientId) : clientId_(clientId), client_(socket_) {}

void MqttLink::begin(MessageHandler handler) {
  handler_ = handler;
  client_.setServer(Secrets::MQTT_HOST, AppConfig::MQTT_PORT);
  client_.setKeepAlive(AppConfig::MQTT_KEEPALIVE_S);
  client_.setSocketTimeout(AppConfig::MQTT_SOCKET_TIMEOUT_S);
  client_.setBufferSize(AppConfig::MQTT_BUFFER_SIZE);
  client_.setCallback([this](char *topic, uint8_t *payload, unsigned int length) {
    String text;
    text.reserve(length);
    for (unsigned int i = 0; i < length; ++i) {
      text += static_cast<char>(payload[i]);
    }
    handler_(String(topic), text);
  });
}

void MqttLink::configureSession(const String &statusTopic, const std::vector<String> &subscriptions) {
  statusTopic_ = statusTopic;
  subscriptions_ = subscriptions;
  if (client_.connected()) {
    // Переподключаемся сразу, чтобы брокер запомнил новый Last Will
    client_.disconnect();
    hasAttempted_ = false;
  }
}

bool MqttLink::connected() {
  return client_.connected();
}

void MqttLink::update(bool networkReady) {
  if (!networkReady) {
    return;
  }
  if (client_.connected()) {
    client_.loop();
    return;
  }
  unsigned long now = millis();
  if (hasAttempted_ && now - lastAttemptMs_ < AppConfig::MQTT_RECONNECT_INTERVAL_MS) {
    return;
  }
  hasAttempted_ = true;
  lastAttemptMs_ = now;
  connect();
}

bool MqttLink::publish(const String &topic, const String &payload, bool retained) {
  return client_.publish(topic.c_str(), payload.c_str(), retained);
}

void MqttLink::connect() {
  Serial.printf("[mqtt] connecting to %s:%u as %s\n", Secrets::MQTT_HOST, AppConfig::MQTT_PORT, clientId_.c_str());
  bool ok;
  if (statusTopic_.isEmpty()) {
    ok = client_.connect(clientId_.c_str());
  } else {
    // Last Will: если связь оборвётся, брокер сам опубликует "offline"
    ok = client_.connect(clientId_.c_str(), statusTopic_.c_str(), 1, true, "offline");
  }
  if (!ok) {
    // -2: брокер недоступен по сети (не тот IP, брокер не запущен, файрвол или изоляция клиентов в Wi-Fi)
    Serial.printf("[mqtt] connect failed, state %d\n", client_.state());
    return;
  }
  if (!statusTopic_.isEmpty()) {
    client_.publish(statusTopic_.c_str(), "online", true);
  }
  for (const String &topic : subscriptions_) {
    client_.subscribe(topic.c_str(), 1);
    Serial.printf("[mqtt] subscribed to %s\n", topic.c_str());
  }
  Serial.println("[mqtt] connected");
}
