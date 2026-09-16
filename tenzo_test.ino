#include <Arduino.h>
#include <HX711.h>
#include <SPI.h>
#include <MFRC522.h>
#include <GyverTM1637.h>
#include <cmath>
#include <cstdlib>

// Лоток 1 по актуальной схеме.
constexpr uint8_t HX_DOUT = 36;       // VP
constexpr uint8_t HX_SCK = 32;
constexpr uint8_t DISPLAY_CLK = 33;
constexpr uint8_t DISPLAY_DIO = 25;

constexpr uint8_t RFID_SCK = 22;
constexpr uint8_t RFID_MISO = 21;
constexpr uint8_t RFID_MOSI = 23;
constexpr uint8_t RFID_SS = 19;       // SDA/SS на модуле RC522
constexpr uint8_t RFID_RST = 16;

constexpr uint8_t DISPLAY_BRIGHTNESS = 3;
constexpr unsigned long INTERVAL_MS = 1000;
constexpr uint8_t MAX_TAGS = 20;
constexpr uint8_t MAX_UID_SIZE = 10;
constexpr double EMPTY_THRESHOLD_G = 0.5;

HX711 scale;
GyverTM1637 display(DISPLAY_CLK, DISPLAY_DIO);
MFRC522 rfid(RFID_SS, RFID_RST);

struct TagProfile {
  byte uid[MAX_UID_SIZE];
  byte uidSize;
  String name;
  double unitMass;
};

TagProfile profiles[MAX_TAGS];
uint8_t profileCount = 0;

byte currentUid[MAX_UID_SIZE];
byte currentUidSize = 0;
bool tagAvailable = false;

int64_t sampleSum = 0;
uint32_t sampleCount = 0;
unsigned long windowStart = 0;

double zeroOffset = 0;
double countsPerGram = 1;
double lastNetCounts = 0;

bool taring = true;
bool calibrated = false;
bool measurementAvailable = false;

String commandLine;
bool commandOverflow = false;

void showDashes() {
  display.displayByte(0x40, 0x40, 0x40, 0x40);
}

void showError() {
  display.displayByte(0x00, 0x79, 0x50, 0x50);  // " Err"
}

void showOverflow() {
  display.displayByte(0x00, 0x3F, 0x71, 0x38);  // " OFL"
}

double weigh(double netCounts) {
  return netCounts / countsPerGram;
}

int roundToInt(double value) {
  return static_cast<int>(value >= 0.0 ? value + 0.5 : value - 0.5);
}

bool sameUid(const byte* first, byte firstSize,
             const byte* second, byte secondSize) {
  if (firstSize != secondSize) return false;
  for (byte i = 0; i < firstSize; ++i) {
    if (first[i] != second[i]) return false;
  }
  return true;
}

String uidToString(const byte* uid, byte uidSize) {
  const char hex[] = "0123456789ABCDEF";
  String result;
  result.reserve(uidSize * 3);
  for (byte i = 0; i < uidSize; ++i) {
    if (i > 0) result += ':';
    result += hex[(uid[i] >> 4) & 0x0F];
    result += hex[uid[i] & 0x0F];
  }
  return result;
}

int findProfile(const byte* uid, byte uidSize) {
  for (uint8_t i = 0; i < profileCount; ++i) {
    if (sameUid(profiles[i].uid, profiles[i].uidSize, uid, uidSize)) {
      return i;
    }
  }
  return -1;
}

void clearProfiles() {
  for (uint8_t i = 0; i < profileCount; ++i) {
    profiles[i].name = "";
    profiles[i].unitMass = 0;
    profiles[i].uidSize = 0;
  }
  profileCount = 0;
}

void updateDisplay() {
  if (taring || !calibrated || !measurementAvailable || !tagAvailable) {
    showDashes();
    return;
  }

  int profileIndex = findProfile(currentUid, currentUidSize);
  if (profileIndex < 0 || profiles[profileIndex].unitMass <= 0) {
    showDashes();
    return;
  }

  double mass = weigh(lastNetCounts);
  if (!std::isfinite(mass)) {
    showError();
    return;
  }

  if (std::fabs(mass) <= EMPTY_THRESHOLD_G) mass = 0;
  if (mass < 0) {
    showError();
    return;
  }

  double calculatedCount = mass / profiles[profileIndex].unitMass;
  if (!std::isfinite(calculatedCount) || calculatedCount >= 9999.5) {
    showOverflow();
    return;
  }

  display.displayInt(roundToInt(calculatedCount));
}

void readRfid() {
  if (!rfid.PICC_IsNewCardPresent()) return;
  if (!rfid.PICC_ReadCardSerial()) return;

  byte uidSize = rfid.uid.size;
  if (uidSize > MAX_UID_SIZE) uidSize = MAX_UID_SIZE;

  bool changed = !tagAvailable ||
    !sameUid(currentUid, currentUidSize, rfid.uid.uidByte, uidSize);

  currentUidSize = uidSize;
  for (byte i = 0; i < uidSize; ++i) {
    currentUid[i] = rfid.uid.uidByte[i];
  }
  tagAvailable = true;

  if (changed) {
    Serial.print("Reader 1 detected tag: ");
    Serial.println(uidToString(currentUid, currentUidSize));

    int profileIndex = findProfile(currentUid, currentUidSize);
    if (profileIndex >= 0) {
      Serial.print("Mapped object: ");
      Serial.print(profiles[profileIndex].name);
      Serial.print(" | Unit mass: ");
      Serial.print(profiles[profileIndex].unitMass, 3);
      Serial.println(" g");
    } else {
      Serial.println("Tag is not mapped. Put one object in the empty tray and use: p NAME");
    }
    updateDisplay();
  }

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}

void resetWindow() {
  sampleSum = 0;
  sampleCount = 0;
  windowStart = millis();
}

void startTare() {
  taring = true;
  measurementAvailable = false;
  resetWindow();
  showDashes();
  Serial.println("Taring: keep the empty tagged tray still for 1 second.");
}

void printMappings() {
  Serial.println("Reader 1 mappings:");
  if (profileCount == 0) {
    Serial.println("None");
    return;
  }

  for (uint8_t i = 0; i < profileCount; ++i) {
    Serial.print(i + 1);
    Serial.print(". UID ");
    Serial.print(uidToString(profiles[i].uid, profiles[i].uidSize));
    Serial.print(" -> ");
    Serial.print(profiles[i].name);
    Serial.print(" | ");
    Serial.print(profiles[i].unitMass, 3);
    Serial.println(" g/object");
  }
}

void printCurrentTag() {
  if (!tagAvailable) {
    Serial.println("Reader 1 has not detected a tag yet.");
    return;
  }

  Serial.print("Reader 1 current tag: ");
  Serial.println(uidToString(currentUid, currentUidSize));
  int profileIndex = findProfile(currentUid, currentUidSize);
  if (profileIndex < 0) {
    Serial.println("This tag is not mapped.");
  } else {
    Serial.print("Object: ");
    Serial.print(profiles[profileIndex].name);
    Serial.print(" | Unit mass: ");
    Serial.print(profiles[profileIndex].unitMass, 3);
    Serial.println(" g");
  }
}

void calibrateScale(double referenceMass) {
  if (referenceMass <= 0 || !std::isfinite(referenceMass)) {
    Serial.println("Use a positive mass in grams, e.g. c 100");
    return;
  }
  if (!measurementAvailable || taring) {
    Serial.println("Wait for a measurement first.");
    return;
  }
  if (std::fabs(lastNetCounts) < 1.0) {
    Serial.println("No useful signal. Place the reference weight.");
    return;
  }

  double newFactor = lastNetCounts / referenceMass;
  if (!std::isfinite(newFactor) || newFactor == 0) {
    Serial.println("ERROR: invalid calibration factor.");
    return;
  }

  countsPerGram = newFactor;
  calibrated = true;
  clearProfiles();

  Serial.print("Calibration saved. Counts/g: ");
  Serial.println(countsPerGram, 6);
  Serial.println("RFID mappings cleared because unit masses must be measured again.");
  updateDisplay();
}

void mapCurrentTag(String name) {
  name.trim();
  if (name.length() == 0) {
    Serial.println("Enter an object name: p Bolt");
    return;
  }
  if (!tagAvailable) {
    Serial.println("Scan the tray tag first.");
    return;
  }
  if (!calibrated) {
    Serial.println("Calibrate first with c MASS.");
    return;
  }
  if (!measurementAvailable || taring) {
    Serial.println("Wait for a measurement first.");
    return;
  }

  double unitMass = weigh(lastNetCounts);
  if (!std::isfinite(unitMass) || unitMass <= EMPTY_THRESHOLD_G) {
    Serial.println("Unit mass is too small. Put exactly one object in the empty tray.");
    return;
  }

  int index = findProfile(currentUid, currentUidSize);
  if (index < 0) {
    if (profileCount >= MAX_TAGS) {
      Serial.println("RFID mapping list is full.");
      return;
    }
    index = profileCount++;
  }

  profiles[index].uidSize = currentUidSize;
  for (byte i = 0; i < currentUidSize; ++i) {
    profiles[index].uid[i] = currentUid[i];
  }
  profiles[index].name = name;
  profiles[index].unitMass = unitMass;

  Serial.print("Mapped reader 1 + tag ");
  Serial.print(uidToString(currentUid, currentUidSize));
  Serial.print(" -> ");
  Serial.print(name);
  Serial.print(" | Unit mass: ");
  Serial.print(unitMass, 3);
  Serial.println(" g");
  updateDisplay();
}

void processCommand(String command) {
  command.trim();

  if (command == "t" || command == "T") {
    startTare();
    return;
  }
  if (command == "l" || command == "L") {
    printMappings();
    return;
  }
  if (command == "u" || command == "U") {
    printCurrentTag();
    return;
  }
  if (command.startsWith("c ") || command.startsWith("C ")) {
    String massText = command.substring(2);
    massText.trim();
    massText.replace(',', '.');
    const char* start = massText.c_str();
    char* end = nullptr;
    double referenceMass = std::strtod(start, &end);
    if (end == start || *end != '\0') {
      Serial.println("Invalid mass. Example: c 100.5");
      return;
    }
    calibrateScale(referenceMass);
    return;
  }
  if (command.startsWith("p ") || command.startsWith("P ")) {
    mapCurrentTag(command.substring(2));
    return;
  }

  Serial.println("Commands: t | c 100 | u | p Bolt | l");
}

void dispatchCommand() {
  if (commandOverflow) {
    Serial.println("Command too long.");
  } else if (commandLine.length() > 0) {
    Serial.print("Received: [");
    Serial.print(commandLine);
    Serial.println("]");
    processCommand(commandLine);
  }
  commandLine = "";
  commandOverflow = false;
}

void readCommands() {
  static unsigned long lastCharTime = 0;
  while (Serial.available() > 0) {
    char ch = Serial.read();
    lastCharTime = millis();
    if (ch == '\n' || ch == '\r') {
      dispatchCommand();
    } else if (!commandOverflow) {
      if (commandLine.length() < 100) {
        commandLine += ch;
      } else {
        commandLine = "";
        commandOverflow = true;
      }
    }
  }

  if ((commandLine.length() > 0 || commandOverflow) &&
      millis() - lastCharTime >= 300) {
    dispatchCommand();
  }
}

void finishWindow() {
  if (sampleCount == 0) {
    measurementAvailable = false;
    showError();
    Serial.println("ERROR: no HX711 data. Check wiring.");
    resetWindow();
    return;
  }

  double average = static_cast<double>(sampleSum) / sampleCount;
  if (taring) {
    zeroOffset = average;
    taring = false;
    measurementAvailable = false;
    showDashes();
    Serial.println("Zero set. Place the reference weight or objects.");
  } else {
    lastNetCounts = average - zeroOffset;
    measurementAvailable = true;
    updateDisplay();

    if (calibrated) {
      double mass = weigh(lastNetCounts);
      Serial.print("Weight: ");
      Serial.print(mass, 3);
      Serial.print(" g");

      if (tagAvailable) {
        int profileIndex = findProfile(currentUid, currentUidSize);
        Serial.print(" | UID: ");
        Serial.print(uidToString(currentUid, currentUidSize));
        if (profileIndex >= 0) {
          double safeMass = std::fabs(mass) <= EMPTY_THRESHOLD_G ? 0 : mass;
          int count = safeMass >= 0
            ? roundToInt(safeMass / profiles[profileIndex].unitMass)
            : 0;
          Serial.print(" | Object: ");
          Serial.print(profiles[profileIndex].name);
          Serial.print(" | Count: ");
          Serial.print(count);
        } else {
          Serial.print(" | Tag not mapped");
        }
      } else {
        Serial.print(" | No tag detected");
      }
    } else {
      Serial.print("NET / 1000: ");
      Serial.print(lastNetCounts / 1000.0, 3);
      Serial.print(" | Not calibrated");
    }

    Serial.print(" | Samples: ");
    Serial.println(sampleCount);
  }
  resetWindow();
}

void setup() {
  Serial.begin(115200);

  display.clear();
  display.brightness(DISPLAY_BRIGHTNESS);
  display.point(false);
  showDashes();

  scale.begin(HX_DOUT, HX_SCK, 128);

  SPI.begin(RFID_SCK, RFID_MISO, RFID_MOSI, RFID_SS);
  rfid.PCD_Init();

  commandLine.reserve(100);

  Serial.println("Tray 1: HX711 + TM1637 + RC522.");
  Serial.println("HX711: DOUT=VP/GPIO36, SCK=32.");
  Serial.println("TM1637: CLK=33, DIO=25.");
  Serial.println("RC522: SCK=22, MISO=21, MOSI=23, SS=19, RST=16.");
  Serial.println("Display shows object count for the mapped tag.");
  Serial.println("Commands: t | c 100 | u | p Bolt | l");
  Serial.println("Start with the empty tagged tray on the scale.");

  startTare();
}

void loop() {
  if (millis() - windowStart >= INTERVAL_MS) finishWindow();

  readCommands();
  readRfid();

  if (scale.is_ready()) {
    sampleSum += scale.read();
    ++sampleCount;
  }

  yield();
}
