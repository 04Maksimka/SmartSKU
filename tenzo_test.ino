#include <Arduino.h>
#include <HX711.h>

constexpr uint8_t HX_DOUT = 19;
constexpr uint8_t HX_SCK = 18;

HX711 scale;
long zeroOffset = 0;
bool zeroSet = false;

// Усреднение с проверкой готовности перед каждым измерением.
bool readAverage(long &result, uint8_t count) {
  int64_t sum = 0;

  for (uint8_t i = 0; i < count; ++i) {
    if (!scale.wait_ready_timeout(1000)) {
      Serial.println(
        "ERROR: HX711 not ready. Check power, GND, DT and SCK."
      );
      return false;
    }

    sum += scale.read();
  }

  result = static_cast<long>(sum / count);
  return true;
}

void tareSensor() {
  Serial.println("Taring: remove load and keep sensor still...");

  long value;
  if (readAverage(value, 20)) {
    zeroOffset = value;
    zeroSet = true;
    Serial.println("Zero set. Apply load. Send t to tare again.");
  }
}

void setup() {
  Serial.begin(115200);

  // Канал A, усиление 128.
  scale.begin(HX_DOUT, HX_SCK, 128);

  delay(1500);
  Serial.println("HX711 test. Readings are ADC counts, NOT grams.");

  tareSensor();
}

void loop() {
  while (Serial.available()) {
    char command = Serial.read();

    if (command == 't' || command == 'T') {
      tareSensor();
    }
  }

  long raw;
  if (readAverage(raw, 5)) {
    Serial.print("RAW: ");
    Serial.print(raw);

    if (zeroSet) {
      Serial.print("  NET: ");
      Serial.println(raw - zeroOffset);
    } else {
      Serial.println("  Zero not set: remove load and send t.");
    }
  }

  delay(100);
}
