"""Minimal MCP client over streamable HTTP (JSON-RPC 2.0), standard library only.

Only tools named in the allowlist can be called. The allowlist holds
read-only Radar tools, so this client can never change the cluster.
"""

import itertools
import json
from urllib.request import Request, urlopen

READ_ONLY_TOOLS = frozenset({"diagnose", "get_resource", "get_events", "list_resources"})
PROTOCOL_VERSION = "2025-06-18"


class McpError(Exception):
    pass


class McpClient:
    def __init__(self, url, token, timeout=20.0, allowed_tools=READ_ONLY_TOOLS, opener=urlopen):
        self.url = url
        self.token = token
        self.timeout = timeout
        self.allowed_tools = frozenset(allowed_tools)
        self._opener = opener
        self._ids = itertools.count(1)
        self._session_id = None

    def call_tool(self, name, arguments):
        if name not in self.allowed_tools:
            raise McpError(f"tool {name!r} is not on the read-only allowlist")
        if self._session_id is None:
            self._initialize()
        result = self._rpc("tools/call", {"name": name, "arguments": arguments})
        if result.get("isError"):
            raise McpError(_text(result) or f"{name} returned an error")
        return result

    def _initialize(self):
        self._rpc(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "backstage-badge-control", "version": "1"},
            },
        )
        self._post({"jsonrpc": "2.0", "method": "notifications/initialized"}, expect_body=False)

    def _rpc(self, method, params):
        request_id = next(self._ids)
        message = self._post({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
        if "error" in message:
            raise McpError(f"{method}: {message['error'].get('message', message['error'])}")
        return message.get("result", {})

    def _post(self, payload, expect_body=True):
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": PROTOCOL_VERSION,
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        if self._session_id:
            headers["Mcp-Session-Id"] = self._session_id
        request = Request(self.url, data=json.dumps(payload).encode(), headers=headers, method="POST")
        with self._opener(request, timeout=self.timeout) as response:
            session = response.headers.get("Mcp-Session-Id")
            if session:
                self._session_id = session
            if not expect_body:
                return None
            body = response.read().decode()
            content_type = response.headers.get("Content-Type", "")
        if "text/event-stream" in content_type:
            return _last_sse_message(body, payload.get("id"))
        return json.loads(body)


def _last_sse_message(body, request_id):
    found = None
    for event in body.split("\n\n"):
        data = "\n".join(line[5:].lstrip() for line in event.splitlines() if line.startswith("data:"))
        if not data:
            continue
        message = json.loads(data)
        if message.get("id") == request_id:
            found = message
    if found is None:
        raise McpError("no response for request in event stream")
    return found


def _text(result):
    return "\n".join(part.get("text", "") for part in result.get("content", []) if part.get("type") == "text")


def result_text(result):
    structured = result.get("structuredContent")
    if structured is not None:
        return json.dumps(structured)
    return _text(result)
