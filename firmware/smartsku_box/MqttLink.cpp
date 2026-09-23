#include "MqttLink.h"

#include <ESPmDNS.h>
#include <time.h>

#include "AppConfig.h"
#include "TrustedRoots.h"

MqttLink::MqttLink(const String &clientId) : clientId_(clientId), client_(plainSocket_) {
  secureSocket_.setCACert(TrustedRoots::PEM);
  // По умолчанию рукопожатие ждёт до 120 с — всё это время главный цикл (дисплеи, весы) стоял бы
  secureSocket_.setHandshakeTimeout(AppConfig::MQTT_TLS_HANDSHAKE_TIMEOUT_S);
}

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

void MqttLink::setServer(const NetworkSettings &settings) {
  host_ = settings.mqttHost;
  port_ = settings.mqttPort;
  tls_ = settings.mqttTls;
  username_ = settings.mqttUsername;
  password_ = settings.mqttPassword;
  lastError_ = 0;
  failedAttempts_ = 0;
  if (client_.connected()) {
    client_.disconnect();
  }
  if (tls_) {
    client_.setClient(secureSocket_);
  } else {
    client_.setClient(plainSocket_);
  }
  hasAttempted_ = false;
}

// Без точного времени TLS отвергнет сертификат как «ещё не действующий». Синхронизация идёт в фоне
bool MqttLink::clockReady() {
  if (time(nullptr) > AppConfig::CLOCK_VALID_AFTER) {
    return true;
  }
  if (!clockRequested_) {
    configTime(0, 0, AppConfig::NTP_SERVER_PRIMARY, AppConfig::NTP_SERVER_SECONDARY);
    clockRequested_ = true;
  }
  Serial.println("[mqtt] waiting for the clock (NTP) before TLS");
  return false;
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

void MqttLink::setPaused(bool paused) {
  if (paused == paused_) {
    return;
  }
  paused_ = paused;
  if (paused && client_.connected()) {
    // Чистое отключение не запускает Last Will — сообщаем offline сами
    if (!statusTopic_.isEmpty()) {
      client_.publish(statusTopic_.c_str(), "offline", true);
    }
    client_.disconnect();
    Serial.println("[mqtt] paused: Bluetooth needs the memory");
  }
  hasAttempted_ = false;
}

void MqttLink::update(bool networkReady) {
  if (paused_ || !networkReady || host_.isEmpty()) {
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
  if (tls_ && !clockReady()) {
    return;
  }
  connect();
}

bool MqttLink::publish(const String &topic, const String &payload, bool retained) {
  return client_.publish(topic.c_str(), payload.c_str(), retained);
}

void MqttLink::connect() {
  Serial.printf("[mqtt] connecting to %s:%u%s as %s\n", host_.c_str(), port_, tls_ ? " (TLS)" : "", clientId_.c_str());
  if (!resolveServer()) {
    lastError_ = MQTT_CONNECT_FAILED;
    ++failedAttempts_;
    return;
  }
  unsigned long startedMs = millis();
  const char *user = username_.isEmpty() ? nullptr : username_.c_str();
  const char *pass = username_.isEmpty() ? nullptr : password_.c_str();
  // Last Will: если связь оборвётся, брокер сам опубликует "offline"
  const char *willTopic = statusTopic_.isEmpty() ? nullptr : statusTopic_.c_str();
  bool ok = client_.connect(clientId_.c_str(), user, pass, willTopic, 1, true, willTopic ? "offline" : nullptr);
  if (!ok) {
    // -2: брокер недоступен по сети (не тот адрес, брокер не запущен, файрвол, изоляция клиентов в Wi-Fi) или
    // не прошёл TLS; 4/5: брокер отверг логин и пароль
    lastError_ = client_.state();
    ++failedAttempts_;
    Serial.printf("[mqtt] connect failed, state %d\n", lastError_);
    if (tls_) {
      char reason[128];
      int code = secureSocket_.lastError(reason, sizeof(reason));
      if (code != 0) {
        Serial.printf(
          "[mqtt] TLS error %d: %s (after %lu ms, free heap %u, largest block %u)\n", code, reason, millis() - startedMs,
          ESP.getFreeHeap(), ESP.getMaxAllocHeap()
        );
      }
    }
    return;
  }
  lastError_ = 0;
  failedAttempts_ = 0;
  Serial.printf("[mqtt] connected in %lu ms, free heap %u\n", millis() - startedMs, ESP.getFreeHeap());
  if (!statusTopic_.isEmpty()) {
    client_.publish(statusTopic_.c_str(), "online", true);
  }
  for (const String &topic : subscriptions_) {
    client_.subscribe(topic.c_str(), 1);
    Serial.printf("[mqtt] subscribed to %s\n", topic.c_str());
  }
  Serial.println("[mqtt] connected");
}
