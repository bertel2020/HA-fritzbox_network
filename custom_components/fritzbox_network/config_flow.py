"""Config flow for the FRITZ!Box network integration."""

from __future__ import annotations

from collections.abc import Mapping
import ipaddress
import logging
import re
from typing import Any
from urllib.parse import urlparse

from fritzconnection.core.exceptions import (
    FritzAuthorizationError,
    FritzConnectionException,
    FritzSecurityError,
)
from homeassistant.config_entries import ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_PORT, CONF_USERNAME
from homeassistant.core import HomeAssistant
from homeassistant.helpers import selector
from homeassistant.helpers.service_info.ssdp import (
    ATTR_UPNP_FRIENDLY_NAME,
    ATTR_UPNP_MODEL_NAME,
    ATTR_UPNP_UDN,
    SsdpServiceInfo,
)
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
    CONF_SHOW_VENDOR,
    CONF_SKIP_OFFLINE,
    CONF_STALE_DAYS,
    CONF_STALE_REPAIR,
    CONF_USE_TLS,
    CONF_WAKE_ON_LAN_WIFI,
    DEFAULT_ADOPT_NAMES,
    DEFAULT_CONSIDER_HOME,
    DEFAULT_IGNORE_GUESTS,
    DEFAULT_IGNORE_PRIVATE_MACS,
    DEFAULT_SCAN_INTERVAL,
    DEFAULT_SHOW_VENDOR,
    DEFAULT_SKIP_OFFLINE,
    DEFAULT_STALE_DAYS,
    DEFAULT_STALE_REPAIR,
    DEFAULT_WAKE_ON_LAN_WIFI,
    DOMAIN,
    FILTER_ALL,
    FILTER_EXCLUDE,
    FILTER_INCLUDE,
)
from .coordinator import FritzNetworkConfigEntry

_LOGGER = logging.getLogger(__name__)

_PORT = vol.All(int, vol.Range(min=1, max=65535))

STEP_USER_DATA_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_HOST, default="192.168.178.1"): str,
        vol.Required(CONF_USERNAME): str,
        vol.Required(CONF_PASSWORD): selector.TextSelector(
            selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)
        ),
        vol.Optional(CONF_USE_TLS, default=False): bool,
        vol.Optional(CONF_PORT): _PORT,
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
        return {
            "serial": client.serial_number,
            "model": client.model_name,
            "repeater": client.is_mesh_repeater(),
        }

    return await hass.async_add_executor_job(_connect_and_check)


# the confirmation of a box found by discovery: its address is known, the login is not
STEP_CONFIRM_DATA_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_USERNAME): str,
        vol.Required(CONF_PASSWORD): selector.TextSelector(
            selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)
        ),
        vol.Optional(CONF_USE_TLS, default=False): bool,
        vol.Optional(CONF_PORT): _PORT,
    }
)

# the serial number of a box is its MAC address, which its UDN ends with: "...-<12 hex digits>"
_UDN_SERIAL = re.compile(r"[0-9A-Fa-f]{12}$")


def _error_for(err: Exception) -> str:
    if isinstance(err, (FritzAuthorizationError, FritzSecurityError)):
        return "invalid_auth"
    if isinstance(err, (FritzConnectionException, OSError)):
        return "cannot_connect"
    return "unknown"


class FritzNetworkConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for FRITZ!Box network."""

    VERSION = 1

    _host: str | None = None
    _name: str | None = None

    async def async_step_ssdp(self, discovery_info: SsdpServiceInfo) -> ConfigFlowResult:
        """A box found by SSDP: its address and, from the UDN, which box it is."""
        host = urlparse(discovery_info.ssdp_location or "").hostname
        try:
            address = ipaddress.ip_address(host) if host else None
        except ValueError:
            address = None  # a name
        if not host or (address is not None and address.is_link_local):
            return self.async_abort(reason="ignore_ip6_link_local")
        upnp = discovery_info.upnp
        model = upnp.get(ATTR_UPNP_MODEL_NAME) or ""
        if "repeater" in model.lower():
            # only the mesh master knows all devices; the repeaters are asked through it
            return self.async_abort(reason="mesh_repeater")

        udn = (upnp.get(ATTR_UPNP_UDN) or "").removeprefix("uuid:")
        if serial := _UDN_SERIAL.search(udn):
            await self.async_set_unique_id(serial.group(0).upper())
            # a box that has a new address keeps its entry and takes the address over
            self._abort_if_unique_id_configured(updates={CONF_HOST: host})
        self._async_abort_entries_match({CONF_HOST: host})
        self._host = host
        self._name = upnp.get(ATTR_UPNP_FRIENDLY_NAME) or model or host
        if self.hass.config_entries.flow.async_has_matching_flow(self):
            return self.async_abort(reason="already_in_progress")
        self.context.update(
            {
                "title_placeholders": {"name": self._name.replace("FRITZ!Box ", "")},
                "configuration_url": f"http://{host}",
            }
        )
        return await self.async_step_confirm()

    def is_matching(self, other_flow: ConfigFlow) -> bool:
        """Two flows for the same address are the same box."""
        return getattr(other_flow, "_host", None) == self._host

    async def async_step_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """The login for a box found by discovery."""
        errors: dict[str, str] = {}
        if user_input is not None:
            data = {CONF_HOST: self._host, **user_input}
            try:
                info = await _validate_input(self.hass, data)
            except Exception as err:  # noqa: BLE001
                errors["base"] = _error_for(err)
                if errors["base"] == "unknown":
                    _LOGGER.exception("Unexpected error while testing the connection")
            else:
                if info["repeater"]:
                    return self.async_abort(reason="mesh_repeater")
                await self.async_set_unique_id(str(info["serial"] or self._host))
                self._abort_if_unique_id_configured(updates={CONF_HOST: self._host})
                return self.async_create_entry(title=f"{info['model']} ({self._host})", data=data)
        return self.async_show_form(
            step_id="confirm",
            data_schema=self.add_suggested_values_to_schema(STEP_CONFIRM_DATA_SCHEMA, user_input),
            errors=errors,
            description_placeholders={"name": self._name or "", "host": self._host or ""},
        )

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
                if info["repeater"]:
                    errors["base"] = "mesh_repeater"
                    return self.async_show_form(
                        step_id="user",
                        data_schema=self.add_suggested_values_to_schema(
                            STEP_USER_DATA_SCHEMA, user_input
                        ),
                        errors=errors,
                    )
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
                info = await _validate_input(self.hass, data)
            except Exception as err:  # noqa: BLE001
                errors["base"] = _error_for(err)
            else:
                await self.async_set_unique_id(str(info["serial"] or data[CONF_HOST]))
                self._abort_if_unique_id_mismatch(reason="wrong_device")
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

    async def async_step_reconfigure(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Change host, port and TLS, for example after the box got a new address."""
        errors: dict[str, str] = {}
        entry = self._get_reconfigure_entry()
        if user_input is not None:
            data = {**entry.data, **user_input}
            try:
                info = await _validate_input(self.hass, data)
            except Exception as err:  # noqa: BLE001
                errors["base"] = _error_for(err)
            else:
                await self.async_set_unique_id(str(info["serial"] or data[CONF_HOST]))
                self._abort_if_unique_id_mismatch(reason="wrong_device")
                return self.async_update_reload_and_abort(
                    entry, data=data, title=f"{info['model']} ({data[CONF_HOST]})"
                )

        schema = vol.Schema(
            {
                vol.Required(CONF_HOST): str,
                vol.Optional(CONF_USE_TLS): bool,
                vol.Optional(CONF_PORT): _PORT,
            }
        )
        return self.async_show_form(
            step_id="reconfigure",
            data_schema=self.add_suggested_values_to_schema(schema, entry.data),
            errors=errors,
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
                    CONF_SHOW_VENDOR,
                    default=options.get(CONF_SHOW_VENDOR, DEFAULT_SHOW_VENDOR),
                ): bool,
                vol.Optional(
                    CONF_WAKE_ON_LAN_WIFI,
                    default=options.get(CONF_WAKE_ON_LAN_WIFI, DEFAULT_WAKE_ON_LAN_WIFI),
                ): bool,
                vol.Optional(
                    CONF_STALE_REPAIR,
                    default=options.get(CONF_STALE_REPAIR, DEFAULT_STALE_REPAIR),
                ): bool,
                vol.Optional(
                    CONF_STALE_DAYS,
                    default=options.get(CONF_STALE_DAYS, DEFAULT_STALE_DAYS),
                ): vol.All(int, vol.Range(min=7, max=365)),
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
