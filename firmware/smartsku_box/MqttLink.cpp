#include "MqttLink.h"

#include <ESPmDNS.h>

#include "AppConfig.h"

MqttLink::MqttLink(const String &clientId) : clientId_(clientId), client_(socket_) {}

void MqttLink::begin(MessageHandler handler) {
  handler_ = handler;
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

void MqttLink::setServer(const String &host, uint16_t port) {
  host_ = host;
  port_ = port;
  lastError_ = 0;
  failedAttempts_ = 0;
  if (client_.connected()) {
    client_.disconnect();
  }
  hasAttempted_ = false;
}

// PubSubClient хранит указатель на строку с именем, поэтому передаём ему только IP
bool MqttLink::resolveServer() {
  String host = host_;
  host.toLowerCase();
  if (!host.endsWith(".local")) {
    IPAddress address;
    if (address.fromString(host_)) {
      client_.setServer(address, port_);
    } else {
      client_.setServer(host_.c_str(), port_);
    }
    return true;
  }
  if (!mdnsStarted_) {
    mdnsStarted_ = MDNS.begin(clientId_.c_str());
  }
  IPAddress address = MDNS.queryHost(host_.substring(0, host_.length() - 6), AppConfig::MDNS_QUERY_TIMEOUT_MS);
  if (address == IPAddress()) {
    Serial.printf("[mqtt] %s is not found via mDNS\n", host_.c_str());
    return false;
  }
  Serial.printf("[mqtt] %s is %s\n", host_.c_str(), address.toString().c_str());
  client_.setServer(address, port_);
  return true;
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
  if (!networkReady || host_.isEmpty()) {
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
  Serial.printf("[mqtt] connecting to %s:%u as %s\n", host_.c_str(), port_, clientId_.c_str());
  if (!resolveServer()) {
    lastError_ = MQTT_CONNECT_FAILED;
    ++failedAttempts_;
    return;
  }
  bool ok;
  if (statusTopic_.isEmpty()) {
    ok = client_.connect(clientId_.c_str());
  } else {
    // Last Will: если связь оборвётся, брокер сам опубликует "offline"
    ok = client_.connect(clientId_.c_str(), statusTopic_.c_str(), 1, true, "offline");
  }
  if (!ok) {
    // -2: брокер недоступен по сети (не тот IP, брокер не запущен, файрвол или изоляция клиентов в Wi-Fi)
    lastError_ = client_.state();
    ++failedAttempts_;
    Serial.printf("[mqtt] connect failed, state %d\n", lastError_);
    return;
  }
  lastError_ = 0;
  failedAttempts_ = 0;
  if (!statusTopic_.isEmpty()) {
    client_.publish(statusTopic_.c_str(), "online", true);
  }
  for (const String &topic : subscriptions_) {
    client_.subscribe(topic.c_str(), 1);
    Serial.printf("[mqtt] subscribed to %s\n", topic.c_str());
  }
  Serial.println("[mqtt] connected");
}
