#pragma once

#include <Arduino.h>

// Подключение к Wi-Fi (WPA2 Enterprise или обычный пароль) с логами и переподключением
class WifiConnection {
public:
  void begin();
  void update();
  bool connected() const;

private:
  void connect();
  void printNearbyNetworks() const;

  unsigned long attemptStartedMs_ = 0;
  bool wasConnected_ = false;
};
