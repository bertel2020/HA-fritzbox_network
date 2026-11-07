"""The QR code that joins a Wi-Fi network: what a phone camera reads to log in."""

from __future__ import annotations

from io import BytesIO

# the beacon type the box tells -> the security the QR code names; a type that is not known is
# taken as an open network, as fritzconnection does
BEACON_SECURITY = {
    "WPA": "WPA",
    "11i": "WPA",
    "WPAand11i": "WPA",
    "WPA3": "WPA",
    "11iandWPA3": "WPA",
    "Basic": "WEP",
    "OWE": "nopass",
    "OWETrans": "nopass",
    "None": "nopass",
}


def security_of(beacon_type: str | None) -> str:
    return BEACON_SECURITY.get(beacon_type or "", "nopass")


def wifi_qr_png(ssid: str, password: str | None, security: str) -> bytes:
    """The PNG of the QR code; the password is left out of an open network."""
    import segno.helpers  # noqa: PLC0415 - only a box that has the image entity needs it

    code = segno.helpers.make_wifi(
        ssid=ssid, password=None if security == "nopass" else password, security=security
    )
    stream = BytesIO()
    code.save(stream, kind="png", scale=4, border=2)
    return stream.getvalue()
