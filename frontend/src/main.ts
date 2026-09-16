import { ApiClient } from "./api/client";
import { EmulatorClient } from "./api/emulator-client";
import { CommandService } from "./app/command-service";
import { DashboardStore } from "./app/dashboard-store";
import { EmulatorStore } from "./app/emulator-store";
import { ElementRegistry } from "./app/element-registry";
import { SkuApp } from "./components/sku-app";
import { ConfigLoader } from "./config/app-config";

class Application {
  async start(): Promise<void> {
    new ElementRegistry().register();
    const config = await new ConfigLoader().load(`${import.meta.env.BASE_URL}config.yaml`);
    const api = new ApiClient(config.apiBaseUrl);
    const store = new DashboardStore(api, config);
    const app = new SkuApp();
    app.store = store;
    app.commands = new CommandService(api, store);
    if (config.emulatorBaseUrl) {
      const emulator = new EmulatorClient(config.emulatorBaseUrl);
      app.emulatorApi = emulator;
      app.emulatorStore = new EmulatorStore(emulator, config.refreshIntervalMs);
    }
    document.body.replaceChildren(app);
    store.start();
  }
}

void new Application().start();
