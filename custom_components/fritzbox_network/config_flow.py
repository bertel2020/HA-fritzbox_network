"""Config flow for the FRITZ!Box network integration."""

from __future__ import annotations

from collections.abc import Mapping
import logging
from typing import Any

from fritzconnection.core.exceptions import (
    FritzAuthorizationError,
    FritzConnectionException,
    FritzSecurityError,
)
from homeassistant.config_entries import ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_PORT, CONF_USERNAME
from homeassistant.core import HomeAssistant
from homeassistant.helpers import selector
import voluptuous as vol

from .api import FritzNetworkClient
from .const import (
    CONF_ADOPT_NAMES,
    CONF_CONSIDER_HOME,
    CONF_FILTER_DEVICES,
    CONF_FILTER_MODE,
    CONF_HIDDEN_MACS,
    CONF_IGNORE_GUESTS,
    CONF_IGNORE_PRIVATE_MACS,
    CONF_SCAN_INTERVAL,
    CONF_SKIP_OFFLINE,
    CONF_USE_TLS,
    DEFAULT_ADOPT_NAMES,
    DEFAULT_CONSIDER_HOME,
    DEFAULT_IGNORE_GUESTS,
    DEFAULT_IGNORE_PRIVATE_MACS,
    DEFAULT_SCAN_INTERVAL,
    DEFAULT_SKIP_OFFLINE,
    DOMAIN,
    FILTER_ALL,
    FILTER_EXCLUDE,
    FILTER_INCLUDE,
)
from .coordinator import FritzNetworkConfigEntry

_LOGGER = logging.getLogger(__name__)

STEP_USER_DATA_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_HOST, default="192.168.178.1"): str,
        vol.Required(CONF_USERNAME): str,
        vol.Required(CONF_PASSWORD): selector.TextSelector(
            selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)
        ),
        vol.Optional(CONF_USE_TLS, default=False): bool,
        vol.Optional(CONF_PORT): int,
    }
)


async def _validate_input(hass: HomeAssistant, data: Mapping[str, Any]) -> dict[str, Any]:
    """Connect and log in; blocking calls run in the executor, errors propagate."""
    client = FritzNetworkClient(
        host=data[CONF_HOST],
        port=data.get(CONF_PORT),
        username=data[CONF_USERNAME],
        password=data[CONF_PASSWORD],
        use_tls=data.get(CONF_USE_TLS, False),
    )

    def _connect_and_check() -> dict[str, Any]:
        client.connect()
        return {"serial": client.serial_number, "model": client.model_name}

    return await hass.async_add_executor_job(_connect_and_check)


def _error_for(err: Exception) -> str:
    if isinstance(err, (FritzAuthorizationError, FritzSecurityError)):
        return "invalid_auth"
    if isinstance(err, (FritzConnectionException, OSError)):
        return "cannot_connect"
    return "unknown"


class FritzNetworkConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for FRITZ!Box network."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                info = await _validate_input(self.hass, user_input)
            except Exception as err:  # noqa: BLE001
                errors["base"] = _error_for(err)
                if errors["base"] == "unknown":
                    _LOGGER.exception("Unexpected error while testing the connection")
            else:
                await self.async_set_unique_id(str(info["serial"] or user_input[CONF_HOST]))
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=f"{info['model']} ({user_input[CONF_HOST]})", data=user_input
                )

        return self.async_show_form(
            step_id="user",
            data_schema=self.add_suggested_values_to_schema(STEP_USER_DATA_SCHEMA, user_input),
            errors=errors,
        )

    async def async_step_reauth(self, entry_data: Mapping[str, Any]) -> ConfigFlowResult:
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        entry = self._get_reauth_entry()
        if user_input is not None:
            data = {**entry.data, **user_input}
            try:
                await _validate_input(self.hass, data)
            except Exception as err:  # noqa: BLE001
                errors["base"] = _error_for(err)
            else:
                return self.async_update_reload_and_abort(entry, data=data)

        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_USERNAME, default=entry.data[CONF_USERNAME]): str,
                    vol.Required(CONF_PASSWORD): selector.TextSelector(
                        selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)
                    ),
                }
            ),
            errors=errors,
            description_placeholders={"host": entry.data[CONF_HOST]},
        )

    @staticmethod
    def async_get_options_flow(config_entry: FritzNetworkConfigEntry) -> OptionsFlow:
        return FritzNetworkOptionsFlow()


class FritzNetworkOptionsFlow(OptionsFlow):
    """Polling, presence, filters and hidden devices."""

    def _device_options(self, macs: set[str]) -> list[selector.SelectOptionDict]:
        hosts = {}
        if getattr(self.config_entry, "runtime_data", None) is not None:
            hosts = self.config_entry.runtime_data.all_hosts
        options = [
            selector.SelectOptionDict(
                value=mac, label=f"{hosts[mac].name} ({mac})" if mac in hosts else mac
            )
            for mac in macs
        ]
        return sorted(options, key=lambda o: o["label"].lower())

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> Any:
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        options = self.config_entry.options
        known: set[str] = set()
        if getattr(self.config_entry, "runtime_data", None) is not None:
            known = set(self.config_entry.runtime_data.all_hosts)
        selected = list(options.get(CONF_FILTER_DEVICES, []))
        hidden = list(options.get(CONF_HIDDEN_MACS, []))
        multi = selector.SelectSelectorConfig(
            options=self._device_options(known | set(selected)),
            multiple=True,
            mode=selector.SelectSelectorMode.DROPDOWN,
        )
        hidden_multi = selector.SelectSelectorConfig(
            options=self._device_options(set(hidden)),
            multiple=True,
            mode=selector.SelectSelectorMode.DROPDOWN,
        )
        schema = vol.Schema(
            {
                vol.Optional(
                    CONF_SCAN_INTERVAL,
                    default=options.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
                ): vol.All(int, vol.Range(min=15, max=300)),
                vol.Optional(
                    CONF_CONSIDER_HOME,
                    default=options.get(CONF_CONSIDER_HOME, DEFAULT_CONSIDER_HOME),
                ): vol.All(int, vol.Range(min=0, max=900)),
                vol.Optional(
                    CONF_ADOPT_NAMES,
                    default=options.get(CONF_ADOPT_NAMES, DEFAULT_ADOPT_NAMES),
                ): bool,
                vol.Optional(
                    CONF_SKIP_OFFLINE,
                    default=options.get(CONF_SKIP_OFFLINE, DEFAULT_SKIP_OFFLINE),
                ): bool,
                vol.Optional(
                    CONF_IGNORE_GUESTS,
                    default=options.get(CONF_IGNORE_GUESTS, DEFAULT_IGNORE_GUESTS),
                ): bool,
                vol.Optional(
                    CONF_IGNORE_PRIVATE_MACS,
                    default=options.get(CONF_IGNORE_PRIVATE_MACS, DEFAULT_IGNORE_PRIVATE_MACS),
                ): bool,
                vol.Optional(
                    CONF_FILTER_MODE, default=options.get(CONF_FILTER_MODE, FILTER_ALL)
                ): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=[FILTER_ALL, FILTER_INCLUDE, FILTER_EXCLUDE],
                        translation_key=CONF_FILTER_MODE,
                        mode=selector.SelectSelectorMode.DROPDOWN,
                    )
                ),
                vol.Optional(CONF_FILTER_DEVICES, default=selected): selector.SelectSelector(multi),
                vol.Optional(CONF_HIDDEN_MACS, default=hidden): selector.SelectSelector(
                    hidden_multi
                ),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
