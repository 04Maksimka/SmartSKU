#include "ServiceConsole.h"

#include <cstdlib>

#include "AppConfig.h"

void ServiceConsole::begin() {
  line_.reserve(MAX_LINE);
}

ConsoleCommand ServiceConsole::poll() {
  bool complete = false;
  while (Serial.available() > 0 && !complete) {
    char ch = Serial.read();
    lastCharMs_ = millis();
    if (ch == '\n' || ch == '\r') {
      complete = true;
    } else if (line_.length() < MAX_LINE) {
      line_ += ch;
    } else {
      overflow_ = true;
    }
  }
  // Serial Monitor может слать строку без перевода строки
  if (!complete && !line_.isEmpty() && millis() - lastCharMs_ >= LINE_IDLE_MS) {
    complete = true;
  }
  if (!complete) {
    return {};
  }

  ConsoleCommand command;
  if (overflow_) {
    Serial.println("Command too long.");
    command.type = ConsoleCommand::Type::Invalid;
  } else if (!line_.isEmpty()) {
    command = parse(line_);
  }
  line_ = "";
  overflow_ = false;
  return command;
}

ConsoleCommand ServiceConsole::parse(String line) {
  line.trim();
  line.toLowerCase();
  ConsoleCommand command;
  if (line.isEmpty()) {
    return command;
  }
  Serial.printf("> %s\n", line.c_str());

  int space = line.indexOf(' ');
  String name = space < 0 ? line : line.substring(0, space);
  String args = space < 0 ? String() : line.substring(space + 1);
  args.trim();

  if (name == "s") {
    command.type = ConsoleCommand::Type::Status;
  } else if (name == "v") {
    command.type = ConsoleCommand::Type::Verbose;
  } else if (name == "h" || name == "help") {
    command.type = ConsoleCommand::Type::Help;
  } else if (name == "setup") {
    command.type = ConsoleCommand::Type::Setup;
  } else if (name == "forget") {
    command.type = ConsoleCommand::Type::ForgetBoxId;
  } else if (name == "reset") {
    command.type = ConsoleCommand::Type::Reset;
  } else if (name == "z") {
    command.type = parseLocker(args, command.lockerId) ? ConsoleCommand::Type::Zero : ConsoleCommand::Type::Invalid;
  } else if (name == "w") {
    command.type = parseReference(args, command) ? ConsoleCommand::Type::Reference : ConsoleCommand::Type::Invalid;
  } else if (name == "c") {
    command.type = parseLocker(args, command.lockerId) ? ConsoleCommand::Type::CellTare : ConsoleCommand::Type::Invalid;
  } else if (name == "e") {
    command.type = parseLocker(args, command.lockerId) ? ConsoleCommand::Type::EraseTag : ConsoleCommand::Type::Invalid;
  } else if (name == "x") {
    command.type = parseLocker(args, command.lockerId) ? ConsoleCommand::Type::Cancel : ConsoleCommand::Type::Invalid;
  } else {
    command.type = ConsoleCommand::Type::Invalid;
  }
  return command;
}

bool ServiceConsole::parseLocker(const String &text, uint8_t &lockerId) {
  String trimmed = text;
  trimmed.trim();
  if (trimmed.isEmpty()) {
    lockerId = 0;
    return true;
  }
  char *end = nullptr;
  long value = std::strtol(trimmed.c_str(), &end, 10);
  if (*end != '\0' || value < 0 || value >= AppConfig::LOCKER_COUNT) {
    Serial.printf("Locker must be 0..%u\n", AppConfig::LOCKER_COUNT - 1);
    return false;
  }
  lockerId = static_cast<uint8_t>(value);
  return true;
}

bool ServiceConsole::parseReference(const String &text, ConsoleCommand &command) {
  int space = text.indexOf(' ');
  if (!parseLocker(space < 0 ? text : text.substring(0, space), command.lockerId)) {
    return false;
  }
  command.grams = space < 0 ? AppConfig::REFERENCE_GRAMS : text.substring(space + 1).toDouble();
  if (command.grams <= 0) {
    Serial.println("Reference weight must be positive grams");
    return false;
  }
  return true;
}

void ServiceConsole::printHelp() {
  Serial.println("Commands:");
  Serial.println("  z [locker]          zero the load cell: the cell is pulled out, nothing on the slot");
  Serial.println("  w [locker] [grams]  scale by the reference weight on the zeroed empty slot (default 100 g)");
  Serial.println("  c [locker]          weigh the inserted EMPTY cell and write its tare to the tag");
  Serial.println("  e [locker]          erase the cell data (tare and piece weight) in the inserted cell tag");
  Serial.println("  x [locker]          cancel calibration");
  Serial.println("  s                   status");
  Serial.println("  v                   toggle readings every second");
  Serial.println("  forget              forget box_id and reboot");
  Serial.println("  reset               forget box_id and load cell setup (keeps network and cell tags) and reboot");
  Serial.println("  setup               Bluetooth setup mode (same as holding BOOT for 3 s)");
}
