#!/bin/sh
set -eu
python -m venv /vision/venv
/vision/venv/bin/pip install --no-cache-dir torch==2.14.1 torchvision==0.29.1 --index-url https://download.pytorch.org/whl/cpu
/vision/venv/bin/pip install --no-cache-dir -r /app/camera/requirements-cluster.txt
# Headless OpenCV provides cv2; avoid the GUI wheel and its libGL dependency.
/vision/venv/bin/pip install --no-cache-dir --no-deps ultralytics==8.4.190
/vision/venv/bin/python - <<'PYMODEL'
import hashlib
from pathlib import Path
from urllib.request import urlopen
path = Path('/vision/yolo26n.pt')
with urlopen('https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo26n.pt', timeout=60) as response:
    data = response.read(20_000_001)
if len(data) > 20_000_000 or hashlib.sha256(data).hexdigest() != '9b09cc8bf347f0fc8a5f7657480587f25db09b34bf33b0652110fb03a8ad4fef':
    raise SystemExit('Model checksum mismatch; refusing to load.')
path.write_bytes(data)
print('Verified YOLO model checksum.')
PYMODEL
