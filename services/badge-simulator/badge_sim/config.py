"""Settings read from the environment (see .env.example)."""

import os
from dataclasses import dataclass

from . import STATION_IDS


def _float(name, default):
    value = os.environ.get(name)
    return float(value) if value else default


@dataclass
class Settings:
    # all: control and both stations in one process (local default).
    # control: badge-control only; stations reach it over HTTP.
    # station: one station (station_id) that talks to control_url.
    role: str = "all"
    station_id: str = "station-a"
    control_url: str = "http://127.0.0.1:8090"
    port: int = 8090
    host: str = "127.0.0.1"
    namespace: str = "team-backstage"
    room_id: str = "room-c"
    stations: tuple = STATION_IDS
    incident_api_base_url: str = ""
    signal_token: str = ""
    internal_token: str = ""
    store: str = "mock"
    radar_mode: str = "mock"
    radar_mcp_url: str = "https://api.radarhq.io/mcp"
    radar_token: str = ""
    radar_cluster_id: str = ""
    admin_enabled: bool = False
    artifact_dir: str = ""
    # Simulation timings, in seconds.
    print_seconds: float = 1.0
    heartbeat_seconds: float = 1.0
    heartbeat_timeout: float = 5.0
    health_report_seconds: float = 10.0

    @classmethod
    def from_env(cls):
        env = os.environ.get
        return cls(
            role=env("BADGE_ROLE", "all"),
            station_id=env("BADGE_STATION_ID", "station-a"),
            control_url=env("BADGE_CONTROL_URL", "http://127.0.0.1:8090").rstrip("/"),
            port=int(env("BADGE_PORT", "8090")),
            host=env("BADGE_HOST", "127.0.0.1"),
            namespace=env("KUBE_NAMESPACE", "team-backstage"),
            room_id=env("BADGE_ROOM_ID", "room-c"),
            incident_api_base_url=env("INCIDENT_API_BASE_URL", "").rstrip("/"),
            signal_token=env("BADGE_SIGNAL_TOKEN", ""),
            internal_token=env("BADGE_INTERNAL_TOKEN", ""),
            store=env("BADGE_STORE", "mock"),
            radar_mode=env("RADAR_MODE", "mock"),
            radar_mcp_url=env("RADAR_MCP_URL", "https://api.radarhq.io/mcp"),
            radar_token=env("RADAR_TOKEN", ""),
            radar_cluster_id=env("RADAR_CLUSTER_ID", ""),
            admin_enabled=env("BADGE_ADMIN_ENABLED", "false").lower() == "true",
            artifact_dir=env("BADGE_ARTIFACT_DIR", ""),
            print_seconds=_float("BADGE_PRINT_SECONDS", 1.0),
            heartbeat_seconds=_float("BADGE_HEARTBEAT_SECONDS", 1.0),
            heartbeat_timeout=_float("BADGE_HEARTBEAT_TIMEOUT", 5.0),
            health_report_seconds=_float("BADGE_HEALTH_REPORT_SECONDS", 10.0),
        )
