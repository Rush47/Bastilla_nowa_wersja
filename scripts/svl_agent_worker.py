#!/usr/bin/env python3
"""Real Linux Worker Daemon for a Bastilla OS Agent (Alex, Aria, Astyria, Aurelius).

Runs as an independent process (optionally under the agent's own Unix UID via
runuser -u bastilla-<agent>), loads SVLSystemKernel v5.6.0-QuantumWheel from
svl_core.py, sends real authenticated heartbeats to /api/worker/heartbeat
including its real OS PID and UID, polls /api/worker/next for queued tasks,
executes inference / SVL Core diagnostics, and completes jobs via
/api/worker/complete.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from svl_core import SVLProtectedVariable, SVLSystemKernel, TopologicalInfinityEngine, VisualScope


def post_json(url: str, token: str, payload: dict, timeout: float = 15.0) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: svl_agent_worker.py <Alex|Aria|Astyria|Aurelius>", file=sys.stderr)
        return 2

    agent_name = sys.argv[1].strip()
    if agent_name not in ("Alex", "Aria", "Astyria", "Aurelius"):
        print(f"Unsupported agent: {agent_name}", file=sys.stderr)
        return 2

    token = os.environ.get("SVL_AGENT_TOKEN", "").strip()
    if len(token) < 32:
        print(f"[{agent_name}] Missing or short SVL_AGENT_TOKEN", file=sys.stderr)
        return 2

    base_url = os.environ.get("SVL_BACKEND_URL", "http://127.0.0.1:3000").rstrip("/")
    pid = os.getpid()
    uid = os.getuid()
    gid = os.getgid()

    # Initialize SVL Core v5.6.0-QuantumWheel for this agent identity
    kernel = SVLSystemKernel()
    agent_identity = SVLProtectedVariable(f"AGENT_{agent_name.upper()}", agent_name, "MAXIMUM")
    scope = VisualScope(agent_name, "CAŁOŚĆ")
    engine = TopologicalInfinityEngine(float("-inf"), float("inf"))
    metric_c = round(engine.calculate_metric_c(), 6)

    worker_id = f"svl-{agent_name.lower()}-uid{uid}-pid{pid}"
    print(
        f"[{agent_name}] Worker initialized: workerId={worker_id} PID={pid} UID={uid} GID={gid} "
        f"System={kernel.sys_version.value} Metric_C={metric_c}",
        flush=True,
    )

    last_heartbeat = 0.0
    consecutive_errors = 0
    while True:
        if os.getppid() == 1:
            return 0
        now = time.monotonic()
        if now - last_heartbeat >= 10.0:
            try:
                post_json(
                    f"{base_url}/api/worker/heartbeat",
                    token,
                    {
                        "workerId": worker_id,
                        "pid": pid,
                        "uid": uid,
                        "kernelVersion": kernel.sys_version.value,
                        "metricC": metric_c,
                    },
                    timeout=5.0,
                )
                last_heartbeat = now
                consecutive_errors = 0
            except Exception as exc:
                consecutive_errors += 1
                print(f"[{agent_name}] Heartbeat error: {exc}", file=sys.stderr, flush=True)
                if consecutive_errors >= 5:
                    return 0

        # Poll for queued jobs addressed to this agent
        try:
            res = post_json(
                f"{base_url}/api/worker/next",
                token,
                {"workerId": worker_id, "pid": pid, "uid": uid},
                timeout=8.0,
            )
            job = res.get("job")
            if isinstance(job, dict) and job.get("id"):
                job_id = str(job["id"])
                prompt = str(job.get("content") or "").strip()
                session_id = str(job.get("sessionId") or "")
                print(f"[{agent_name}] Executing job {job_id}: {prompt[:80]}", flush=True)

                # Generate response via backend inference endpoint or local SVL Core telemetry
                report_json = kernel.generate_system_status_report()
                report_data = json.loads(report_json)

                reply_text = ""
                try:
                    inf_res = post_json(
                        f"{base_url}/api/worker/infer",
                        token,
                        {
                            "agent": agent_name,
                            "workerId": worker_id,
                            "pid": pid,
                            "uid": uid,
                            "sessionId": session_id,
                            "prompt": prompt,
                            "svlReport": report_data,
                        },
                        timeout=40.0,
                    )
                    reply_text = str(inf_res.get("content") or "").strip()
                except Exception as inf_exc:
                    print(f"[{agent_name}] Inference fallback: {inf_exc}", file=sys.stderr, flush=True)

                if not reply_text:
                    ui_block = {
                        "components": [
                            {
                                "type": "status",
                                "title": f"{agent_name} · Worker {worker_id}",
                                "status": "online",
                                "text": f"PID: {pid} · UID: {uid} · Jądro: {kernel.sys_version.value} · Metric C: {metric_c}",
                            },
                            {
                                "type": "kv",
                                "title": f"Tożsamość {agent_identity.value} (SVLProtectedVariable · {scope.scope_mode})",
                                "items": [
                                    {"key": "Operator", "value": kernel.operator.value},
                                    {"key": "System", "value": kernel.sys_version.value},
                                    {"key": "Performance", "value": kernel.performance_boost},
                                    {"key": "Compact_Metric_C", "value": str(metric_c)},
                                    {"key": "Unix Worker", "value": f"bastilla-{agent_name.lower()} (UID {uid}, PID {pid})"},
                                ],
                            },
                        ]
                    }
                    reply_text = (
                        f"Odpowiedź z rzeczywistego procesu workera **{agent_name}** "
                        f"(`{worker_id}`, PID `{pid}`, UID `{uid}`, jądro `{kernel.sys_version.value}`).\n\n"
                        f"Odebrano zadanie: `{prompt}`\n\n"
                        f"```svl-ui\n{json.dumps(ui_block, ensure_ascii=False, indent=2)}\n```"
                    )

                post_json(
                    f"{base_url}/api/worker/complete",
                    token,
                    {
                        "jobId": job_id,
                        "workerId": worker_id,
                        "pid": pid,
                        "uid": uid,
                        "content": reply_text,
                    },
                    timeout=10.0,
                )
        except Exception as exc:
            print(f"[{agent_name}] Poll error: {exc}", file=sys.stderr, flush=True)

        time.sleep(2.5)


if __name__ == "__main__":
    raise SystemExit(main())
