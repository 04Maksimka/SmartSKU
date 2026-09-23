from pathlib import Path

import pytest

from smartsku_backend.config import ConfigLoader


class TestConfigLoader:
    def test_secrets_file_overrides_nested_values(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        secrets = tmp_path / "secrets.yaml"
        secrets.write_text("mqtt:\n  password: broker-pass\nonboarding:\n  box_password: box-pass\n", encoding="utf-8")
        monkeypatch.setenv(ConfigLoader.ENV_VARIABLE, "config/config.prod.yaml")
        monkeypatch.setenv(ConfigLoader.SECRETS_ENV_VARIABLE, str(secrets))

        config = ConfigLoader().load()

        assert config.mqtt.username == "backend"
        assert config.mqtt.password == "broker-pass"
        assert config.mqtt.host == "mosquitto"
        assert config.onboarding.box_password == "box-pass"
        assert config.onboarding.broker_tls is True

    def test_without_secrets_the_local_broker_is_anonymous(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv(ConfigLoader.ENV_VARIABLE, "config/config.local.yaml")
        monkeypatch.delenv(ConfigLoader.SECRETS_ENV_VARIABLE, raising=False)

        config = ConfigLoader().load()

        assert config.mqtt.username == ""
        assert config.onboarding.broker_tls is False
