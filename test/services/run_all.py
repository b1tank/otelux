"""
run_all.py — Start all three services in one process.

Spawns gateway (5000), user-service (5001), order-service (5002) as threads.
Press Ctrl+C to stop all.
"""
import sys
import os
import threading
import time
import signal

# Add this directory to path so imports work
sys.path.insert(0, os.path.dirname(__file__))

from user_service import app as user_app, _init_db as init_user_db
from order_service import app as order_app, _init_db as init_order_db
from gateway import app as gateway_app


def run_flask(app, port, name):
    """Run a Flask app in a thread (suppress request logs)."""
    import logging
    log = logging.getLogger('werkzeug')
    log.setLevel(logging.ERROR)
    print(f"  {name} on :{port}")
    app.run(host="0.0.0.0", port=port, debug=False, use_reloader=False)


def main():
    print("Starting OTelux test services...")

    # Init DBs
    init_user_db()
    init_order_db()

    threads = [
        threading.Thread(target=run_flask, args=(user_app, 5001, "user-service"), daemon=True),
        threading.Thread(target=run_flask, args=(order_app, 5002, "order-service"), daemon=True),
        threading.Thread(target=run_flask, args=(gateway_app, 5000, "api-gateway"), daemon=True),
    ]

    for t in threads:
        t.start()

    time.sleep(1)
    print("\nAll services running. Press Ctrl+C to stop.\n")
    print("  api-gateway:   http://localhost:5000")
    print("  user-service:  http://localhost:5001")
    print("  order-service: http://localhost:5002")
    print()

    try:
        signal.pause()
    except KeyboardInterrupt:
        print("\nShutting down...")
        sys.exit(0)


if __name__ == "__main__":
    main()
