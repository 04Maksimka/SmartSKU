#include "BleSetupChannel.h"

#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>

#include "AppConfig.h"

namespace {

class ServerCallbacks : public BLEServerCallbacks {
public:
  explicit ServerCallbacks(BleSetupChannel &channel) : channel_(channel) {}

  void onConnect(BLEServer *) override {
    channel_.onClientConnected();
  }
  void onDisconnect(BLEServer *) override {
    channel_.onClientDisconnected();
  }

private:
  BleSetupChannel &channel_;
};

class RxCallbacks : public BLECharacteristicCallbacks {
public:
  explicit RxCallbacks(BleSetupChannel &channel) : channel_(channel) {}

  void onWrite(BLECharacteristic *characteristic) override {
    channel_.onData(characteristic->getValue());
  }

private:
  BleSetupChannel &channel_;
};

}  // namespace

BleSetupChannel::BleSetupChannel(const String &deviceName) : deviceName_(deviceName), mutex_(xSemaphoreCreateMutex()) {}

void BleSetupChannel::initStack() {
  BLEDevice::init(deviceName_);
  BLEDevice::setMTU(AppConfig::BLE_MTU);
  server_ = BLEDevice::createServer();
  // Колбэки живут всё время работы прошивки: стек хранит на них указатели и после deinit()
  static ServerCallbacks *serverCallbacks = new ServerCallbacks(*this);
  static RxCallbacks *rxCallbacks = new RxCallbacks(*this);
  server_->setCallbacks(serverCallbacks);

  BLEService *service = server_->createService(AppConfig::BLE_SERVICE_UUID);
  BLECharacteristic *rx = service->createCharacteristic(
    AppConfig::BLE_RX_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  rx->setCallbacks(rxCallbacks);
  tx_ = service->createCharacteristic(AppConfig::BLE_TX_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  tx_->addDescriptor(new BLE2902());
  service->start();

  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(AppConfig::BLE_SERVICE_UUID);
  advertising->setScanResponse(true);
  initialized_ = true;
}

void BleSetupChannel::open() {
  if (open_) {
    return;
  }
  if (!initialized_) {
    initStack();
  }
  BLEDevice::startAdvertising();
  open_ = true;
  Serial.printf("[ble] setup mode: visible as %s\n", deviceName_.c_str());
}

// Стек выключается целиком: только так можно вернуть Wi-Fi без энергосбережения
void BleSetupChannel::close() {
  if (!open_) {
    return;
  }
  BLEDevice::deinit(false);
  initialized_ = false;
  server_ = nullptr;
  tx_ = nullptr;
  open_ = false;
  clientConnected_ = false;
  xSemaphoreTake(mutex_, portMAX_DELAY);
  partial_ = "";
  requests_.clear();
  xSemaphoreGive(mutex_);
  Serial.println("[ble] setup mode closed");
}

bool BleSetupChannel::takeConnectedEvent() {
  return connectedEvent_.exchange(false);
}

void BleSetupChannel::onClientConnected() {
  clientConnected_ = true;
  connectedEvent_ = true;
}

void BleSetupChannel::onClientDisconnected() {
  clientConnected_ = false;
  xSemaphoreTake(mutex_, portMAX_DELAY);
  partial_ = "";
  xSemaphoreGive(mutex_);
  // Пока режим настройки открыт, бокс снова виден: фронт может переподключиться
  if (open_) {
    BLEDevice::startAdvertising();
  }
}

void BleSetupChannel::onData(const String &chunk) {
  xSemaphoreTake(mutex_, portMAX_DELAY);
  for (size_t i = 0; i < chunk.length(); ++i) {
    char ch = chunk[i];
    if (ch == '\n') {
      if (!partial_.isEmpty()) {
        requests_.push_back(partial_);
      }
      partial_ = "";
    } else if (partial_.length() < AppConfig::BLE_MAX_REQUEST) {
      partial_ += ch;
    }
  }
  xSemaphoreGive(mutex_);
}

bool BleSetupChannel::pollRequest(String &line) {
  xSemaphoreTake(mutex_, portMAX_DELAY);
  bool has = !requests_.empty();
  if (has) {
    line = requests_.front();
    requests_.pop_front();
  }
  xSemaphoreGive(mutex_);
  return has;
}

void BleSetupChannel::send(const String &line) {
  if (!open_ || !clientConnected_ || tx_ == nullptr) {
    return;
  }
  uint16_t mtu = server_->getPeerMTU(server_->getConnId());
  size_t chunkSize = mtu > 23 ? mtu - 3 : 20;
  String payload = line + "\n";
  for (size_t offset = 0; offset < payload.length(); offset += chunkSize) {
    String chunk = payload.substring(offset, offset + chunkSize);
    tx_->setValue(chunk);
    tx_->notify();
    delay(AppConfig::BLE_CHUNK_DELAY_MS);
  }
}
