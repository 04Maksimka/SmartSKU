import { ApiClient } from "./api/client";
import { DashboardStore } from "./app/dashboard-store";
import { ElementRegistry } from "./app/element-registry";
import { SkuApp } from "./components/sku-app";
import { ConfigLoader } from "./config/app-config";

class Application {
  async start(): Promise<void> {
    new ElementRegistry().register();
    const config = await new ConfigLoader().load(`${import.meta.env.BASE_URL}config.yaml`);
    const store = new DashboardStore(new ApiClient(config.apiBaseUrl), config);
    const app = new SkuApp();
    app.store = store;
    document.body.replaceChildren(app);
    store.start();
  }
}

void new Application().start();
