# Incident API

This service runs the Room B overflow rehearsal. A count replay opens an incident, the organizer approves the Venue plan, and the assigned staff member accepts it. The public view returns to normal after 60 seconds of below-threshold evidence.

## Start locally

From the repository root:

    python3 -m venv .venv
    .venv/bin/python -m pip install -r services/incident-api/requirements-test.txt
    cd services/incident-api
    cp .env.example .env
    set -a
    . ./.env
    set +a
    ../../.venv/bin/python -m uvicorn backstage_api.main:create_app --factory --host 127.0.0.1 --port "$API_PORT"

Set the web app's API base URL to http://127.0.0.1:8000/api/v1 and disable its mock API when it is ready. The example allows the browser origin http://localhost:5173. Set CORS_ALLOWED_ORIGINS to the actual web origin if it differs.

Use Bearer tokens from the example only for local rehearsal. Enter demo-organizer for approval, demo-staff for the first assignment, demo-backup for the replacement, and demo-attendee for the public status view. The server derives each role from its token.

## Rehearse with the board

1. In another terminal, from the repository root, run:

       CAM_SIGNAL_TOKEN=demo-camera .venv/bin/python services/incident-api/replay_overflow.py trigger

2. Approve the Venue plan as the organizer. Poll the incident for the dispatched assignment, then accept it as the assignee. Action responses describe the completed human step. The incident read includes any subsequent automated dispatch.
3. Start the 60-second clearing replay after the staff member accepts:

       CAM_SIGNAL_TOKEN=demo-camera .venv/bin/python services/incident-api/replay_overflow.py clear

4. Check that the public view stays in recovery until the last sample. The final timeline event lists the signal IDs that proved recovery.

Use GET /api/v1/status for the public room view and GET /api/v1/incidents for the organizer board. See the [v1 contract](../../contracts/openapi.yaml) for request and response shapes. Room B counts in the shared replay have no session ID, so a session-scoped identity sees an empty list. This slice uses in-memory data and local transition spans. Restarting the process resets the rehearsal. Report intake, other incident types, durable storage, and trace export are follow-up work.

Run make check-api from the repository root for the accelerated lifecycle and permissions checks.
