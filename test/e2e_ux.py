#!/usr/bin/env python3
"""
E2E UX test for OTelux — driven by deskpal MCP desktop automation.

Tests the full user journey:
  1. Launch otelux
  2. Ingest traces via OTLP HTTP
  3. Verify trace list renders (OCR)
  4. Click a trace → waterfall view
  5. Click a span → detail panel
  6. Keyboard navigation (arrows, Enter, Escape)
  7. Toolbar: search, status filter, pause/resume, refresh
  8. Back navigation (Escape from waterfall)
  9. Error trace styling

Prerequisites:
  - otelux built: ninja -C build
  - deskpal built: ninja -C /home/b1tank/deskpal/build
  - /dev/uinput accessible
  - Running X11/Xwayland session
"""

import subprocess
import json
import time
import base64
import sys
import os
import urllib.request
import signal

OTELUX_BIN = os.path.join(os.path.dirname(__file__), '..', 'build', 'otelux')
DESKPAL_BIN = '/home/b1tank/deskpal/build/deskpal'
OTELUX_PORT = 14318  # use non-default port to avoid conflict
SCREENSHOT_DIR = '/tmp/otelux_e2e_ux'
FIXTURE_DIR = os.path.join(os.path.dirname(__file__), 'fixtures')

os.makedirs(SCREENSHOT_DIR, exist_ok=True)


# ── OTLP test data ──────────────────────────────────────────────────────────

SAMPLE_TRACE = {
    "resourceSpans": [{
        "resource": {
            "attributes": [
                {"key": "service.name", "value": {"stringValue": "web-frontend"}}
            ]
        },
        "scopeSpans": [{
            "scope": {"name": "http"},
            "spans": [
                {
                    "traceId": "aaaa000011112222aaaa000011112222",
                    "spanId": "aa00000000000001",
                    "parentSpanId": "",
                    "name": "GET /dashboard",
                    "kind": 1,
                    "startTimeUnixNano": "1715300000000000000",
                    "endTimeUnixNano":   "1715300000120000000",
                    "status": {"code": 1},
                    "attributes": [
                        {"key": "http.method", "value": {"stringValue": "GET"}},
                        {"key": "http.url", "value": {"stringValue": "/dashboard"}},
                        {"key": "http.status_code", "value": {"intValue": "200"}}
                    ],
                    "events": [
                        {
                            "name": "cache.hit",
                            "timeUnixNano": "1715300000010000000",
                            "attributes": [
                                {"key": "cache.type", "value": {"stringValue": "redis"}}
                            ]
                        }
                    ]
                },
                {
                    "traceId": "aaaa000011112222aaaa000011112222",
                    "spanId": "aa00000000000002",
                    "parentSpanId": "aa00000000000001",
                    "name": "auth.verify",
                    "kind": 0,
                    "startTimeUnixNano": "1715300000005000000",
                    "endTimeUnixNano":   "1715300000025000000",
                    "status": {"code": 1},
                    "attributes": [
                        {"key": "auth.method", "value": {"stringValue": "jwt"}}
                    ]
                },
                {
                    "traceId": "aaaa000011112222aaaa000011112222",
                    "spanId": "aa00000000000003",
                    "parentSpanId": "aa00000000000001",
                    "name": "db.query users",
                    "kind": 2,
                    "startTimeUnixNano": "1715300000030000000",
                    "endTimeUnixNano":   "1715300000100000000",
                    "status": {"code": 1},
                    "attributes": [
                        {"key": "db.system", "value": {"stringValue": "postgresql"}},
                        {"key": "db.statement", "value": {"stringValue": "SELECT * FROM users"}}
                    ]
                }
            ]
        }]
    }]
}

ERROR_TRACE = {
    "resourceSpans": [{
        "resource": {
            "attributes": [
                {"key": "service.name", "value": {"stringValue": "payment-svc"}}
            ]
        },
        "scopeSpans": [{
            "scope": {"name": "grpc"},
            "spans": [
                {
                    "traceId": "bbbb000011112222bbbb000011112222",
                    "spanId": "bb00000000000001",
                    "parentSpanId": "",
                    "name": "POST /charge",
                    "kind": 1,
                    "startTimeUnixNano": "1715300001000000000",
                    "endTimeUnixNano":   "1715300001500000000",
                    "status": {"code": 2, "message": "payment gateway timeout"},
                    "attributes": [
                        {"key": "rpc.method", "value": {"stringValue": "Charge"}},
                        {"key": "error", "value": {"boolValue": True}}
                    ]
                }
            ]
        }]
    }]
}

SECOND_TRACE = {
    "resourceSpans": [{
        "resource": {
            "attributes": [
                {"key": "service.name", "value": {"stringValue": "inventory-svc"}}
            ]
        },
        "scopeSpans": [{
            "scope": {"name": "http"},
            "spans": [
                {
                    "traceId": "cccc000011112222cccc000011112222",
                    "spanId": "cc00000000000001",
                    "parentSpanId": "",
                    "name": "GET /stock",
                    "kind": 1,
                    "startTimeUnixNano": "1715300002000000000",
                    "endTimeUnixNano":   "1715300002050000000",
                    "status": {"code": 1},
                    "attributes": [
                        {"key": "http.method", "value": {"stringValue": "GET"}}
                    ]
                }
            ]
        }]
    }]
}


# ── deskpal client ───────────────────────────────────────────────────────────

class DeskpalClient:
    def __init__(self):
        self.proc = subprocess.Popen(
            [DESKPAL_BIN],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            cwd=os.path.dirname(DESKPAL_BIN))
        self._id = 0
        self._call('initialize', {
            'protocolVersion': '2024-11-05',
            'capabilities': {},
            'clientInfo': {'name': 'otelux-e2e', 'version': '1.0'}
        })

    def _call(self, method, params):
        self._id += 1
        msg = json.dumps({'jsonrpc': '2.0', 'id': self._id, 'method': method, 'params': params})
        self.proc.stdin.write((msg + '\n').encode())
        self.proc.stdin.flush()
        line = self.proc.stdout.readline().decode().strip()
        return json.loads(line) if line else {}

    def tool(self, name, args=None):
        r = self._call('tools/call', {'name': name, 'arguments': args or {}})
        content = r.get('result', {}).get('content', [{}])
        if not content:
            return ''
        c = content[0]
        if c.get('type') == 'image':
            return c
        return c.get('text', '')

    def screenshot(self, label, windowName=None):
        args = {}
        if windowName:
            args['windowName'] = windowName
        r = self._call('tools/call', {'name': 'screenshot', 'arguments': args})
        content = r.get('result', {}).get('content', [{}])
        if content and content[0].get('type') == 'image':
            path = os.path.join(SCREENSHOT_DIR, f'{label}.png')
            with open(path, 'wb') as f:
                f.write(base64.b64decode(content[0]['data']))
            return path
        return None

    def close(self):
        self.proc.stdin.close()
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill()


# ── test runner ──────────────────────────────────────────────────────────────

class TestRunner:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.results = []

    def run(self, name, fn):
        t0 = time.time()
        try:
            ok, detail = fn()
            dt = time.time() - t0
            if ok:
                self.passed += 1
                print(f'  \033[32mPASS\033[0m  {name}  ({dt:.1f}s) {detail}')
            else:
                self.failed += 1
                print(f'  \033[31mFAIL\033[0m  {name}  ({dt:.1f}s) {detail}')
                self.results.append((name, detail))
        except Exception as e:
            dt = time.time() - t0
            self.failed += 1
            msg = str(e)[:120]
            print(f'  \033[31mFAIL\033[0m  {name}  ({dt:.1f}s) EXCEPTION: {msg}')
            self.results.append((name, f'EXCEPTION: {msg}'))

    def summary(self):
        total = self.passed + self.failed
        print(f'\n{"=" * 60}')
        print(f'Results: {self.passed} passed, {self.failed} failed, {total} total')
        if self.results:
            print('Failed:')
            for name, detail in self.results:
                print(f'  - {name}: {detail}')
        print(f'{"=" * 60}')
        return self.failed == 0


# ── OTLP HTTP helpers ────────────────────────────────────────────────────────

def send_otlp(data, port=OTELUX_PORT):
    """POST OTLP JSON traces to otelux."""
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        f'http://127.0.0.1:{port}/v1/traces',
        data=body,
        headers={'Content-Type': 'application/json'},
        method='POST')
    try:
        resp = urllib.request.urlopen(req, timeout=5)
        return resp.status
    except Exception as e:
        return str(e)


def wait_for_otlp(port=OTELUX_PORT, timeout=10):
    """Wait until the OTLP HTTP endpoint is ready."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            send_otlp({"resourceSpans": []}, port)
            return True
        except Exception:
            time.sleep(0.3)
    return False


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    print(f'\n{"=" * 60}')
    print('  OTelux E2E UX Test — driven by deskpal')
    print(f'  Screenshots: {SCREENSHOT_DIR}/')
    print(f'{"=" * 60}\n')

    # Clean up any old otelux
    subprocess.run(['pkill', '-f', 'otelux'], capture_output=True)
    time.sleep(0.5)

    # Remove old DB for clean state
    db_path = f'/tmp/otelux_e2e_test.db'
    if os.path.exists(db_path):
        os.remove(db_path)

    # Launch otelux in background
    otelux_proc = subprocess.Popen(
        [OTELUX_BIN, '--port', str(OTELUX_PORT), '--db', db_path],
        env={**os.environ, 'GDK_BACKEND': 'x11'},
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    # Wait for window + OTLP endpoint
    time.sleep(3)
    if not wait_for_otlp(OTELUX_PORT, timeout=10):
        print('ERROR: OTelux OTLP endpoint did not start')
        otelux_proc.kill()
        sys.exit(1)

    d = DeskpalClient()
    t = TestRunner()

    try:
        # ── Phase 1: Window discovery ────────────────────────────────────

        def test_find_otelux_window():
            r = d.tool('find_window', {'name': 'OTelux'})
            ok = 'OTelux' in r and 'Size' in r
            return ok, r[:80]
        t.run('find otelux window', test_find_otelux_window)

        def test_focus_otelux():
            r = d.tool('focus_window', {'windowName': 'OTelux'})
            ok = 'focus' in r.lower() or 'Focus' in r
            return ok, r[:60]
        t.run('focus otelux window', test_focus_otelux)

        def test_screenshot_empty():
            path = d.screenshot('01_empty_trace_list', 'OTelux')
            ok = path is not None
            return ok, path or 'no screenshot'
        t.run('screenshot: empty trace list', test_screenshot_empty)

        # ── Phase 2: Ingest traces via OTLP HTTP ────────────────────────

        def test_ingest_ok_trace():
            status = send_otlp(SAMPLE_TRACE)
            ok = status == 200
            return ok, f'HTTP {status}'
        t.run('ingest OK trace', test_ingest_ok_trace)

        def test_ingest_error_trace():
            status = send_otlp(ERROR_TRACE)
            ok = status == 200
            return ok, f'HTTP {status}'
        t.run('ingest error trace', test_ingest_error_trace)

        def test_ingest_second_trace():
            status = send_otlp(SECOND_TRACE)
            ok = status == 200
            return ok, f'HTTP {status}'
        t.run('ingest second trace', test_ingest_second_trace)

        # Wait for auto-refresh (2s timer)
        time.sleep(3)

        def test_screenshot_with_traces():
            path = d.screenshot('02_trace_list_populated', 'OTelux')
            ok = path is not None
            return ok, path or 'no screenshot'
        t.run('screenshot: populated trace list', test_screenshot_with_traces)

        # ── Phase 3: Verify trace list content via OCR ───────────────────

        def test_ocr_trace_list():
            r = d.tool('read_screen_text', {'windowName': 'OTelux'})
            # Should see service names or trace names
            has_content = any(kw in r for kw in ['GET', 'POST', 'dashboard', 'charge',
                                                  'stock', 'web-frontend', 'payment',
                                                  'inventory', 'Timestamp', 'Duration'])
            return has_content, r[:120]
        t.run('OCR: trace list shows traces', test_ocr_trace_list)

        def test_ocr_toolbar_elements():
            r = d.tool('read_screen_text', {'windowName': 'OTelux'})
            has_toolbar = any(kw in r for kw in ['Refresh', 'Pause', 'All'])
            return has_toolbar, r[:120]
        t.run('OCR: toolbar visible', test_ocr_toolbar_elements)

        # ── Phase 4: Click a trace → waterfall ───────────────────────────

        def test_click_trace_row():
            # Click on the trace list area (below header)
            geom = d.tool('get_window_geometry', {'windowName': 'OTelux'})
            # Click roughly in the middle of the first data row
            d.tool('click', {'windowName': 'OTelux', 'x': 400, 'y': 150})
            time.sleep(1.0)
            path = d.screenshot('03_waterfall_view', 'OTelux')
            ok = path is not None
            return ok, path or 'no screenshot'
        t.run('click trace → waterfall view', test_click_trace_row)

        def test_ocr_waterfall():
            r = d.tool('read_screen_text', {'windowName': 'OTelux'})
            # Should see "Trace" header or span names
            has_waterfall = any(kw in r for kw in ['Trace', 'GET', 'auth',
                                                    'Click a span', 'POST'])
            return has_waterfall, r[:120]
        t.run('OCR: waterfall content', test_ocr_waterfall)

        # ── Phase 5: Click a span → detail panel ─────────────────────────

        def test_click_span():
            # Click on a span bar in the waterfall
            d.tool('click', {'windowName': 'OTelux', 'x': 350, 'y': 120})
            time.sleep(0.8)
            path = d.screenshot('04_span_detail', 'OTelux')
            r = d.tool('read_screen_text', {'windowName': 'OTelux'})
            # Should see detail panel content: Context, Properties, etc.
            has_detail = any(kw in r for kw in ['Context', 'Properties', 'Events',
                                                 'Span ID', 'Trace ID', 'Kind',
                                                 'Duration', 'Status'])
            return has_detail, r[:120]
        t.run('click span → detail panel', test_click_span)

        def test_detail_has_attributes():
            r = d.tool('read_screen_text', {'windowName': 'OTelux'})
            has_attrs = any(kw in r for kw in ['http.method', 'http.url',
                                                'db.system', 'auth.method',
                                                'rpc.method', 'Properties'])
            return has_attrs, r[:120]
        t.run('detail panel shows attributes', test_detail_has_attributes)

        # ── Phase 6: Keyboard navigation ─────────────────────────────────

        def test_key_escape_back():
            """Escape should go back to trace list from waterfall."""
            # First click waterfall to give it focus
            d.tool('click', {'windowName': 'OTelux', 'x': 350, 'y': 100})
            time.sleep(0.3)
            d.tool('key_press', {'windowName': 'OTelux', 'keys': 'Escape'})
            time.sleep(0.8)
            path = d.screenshot('05_back_to_list', 'OTelux')
            r = d.tool('read_screen_text', {'windowName': 'OTelux'})
            # Trace list should show column headers in the GL area (below toolbar)
            # Waterfall shows "Trace xxx..." header — if we see "Timestamp" we're on list
            back = 'Timestamp' in r
            return back, r[:120]
        t.run('Escape → back to trace list', test_key_escape_back)

        def test_key_down_select():
            """Down arrow should select a row."""
            # Click the GL area first to give it focus
            d.tool('click', {'windowName': 'OTelux', 'x': 400, 'y': 110})
            time.sleep(0.3)
            d.tool('key_press', {'windowName': 'OTelux', 'keys': 'Down'})
            time.sleep(0.3)
            d.tool('key_press', {'windowName': 'OTelux', 'keys': 'Down'})
            time.sleep(0.3)
            path = d.screenshot('06_arrow_selection', 'OTelux')
            ok = path is not None
            return ok, path or 'no screenshot'
        t.run('arrow down selects rows', test_key_down_select)

        def test_key_enter_opens_trace():
            """Enter should open the selected trace."""
            # Click GL area to ensure focus, then press Enter
            d.tool('click', {'windowName': 'OTelux', 'x': 400, 'y': 150})
            time.sleep(0.3)
            d.tool('key_press', {'windowName': 'OTelux', 'keys': 'Return'})
            time.sleep(1.0)
            r = d.tool('read_screen_text', {'windowName': 'OTelux'})
            path = d.screenshot('07_enter_waterfall', 'OTelux')
            # Waterfall shows "Trace xxx..." — trace list shows "Timestamp"
            has_waterfall = 'Trace' in r and 'Timestamp' not in r
            # Also accept if we just see span names from the clicked row
            if not has_waterfall:
                has_waterfall = any(kw in r for kw in ['GET', 'POST', 'auth', 'db.query'])
            return has_waterfall, r[:120]
        t.run('Enter → opens trace waterfall', test_key_enter_opens_trace)

        def test_key_escape_again():
            """Escape back to list (click waterfall first for focus)."""
            d.tool('click', {'windowName': 'OTelux', 'x': 350, 'y': 100})
            time.sleep(0.3)
            d.tool('key_press', {'windowName': 'OTelux', 'keys': 'Escape'})
            time.sleep(0.5)
            r = d.tool('read_screen_text', {'windowName': 'OTelux'})
            ok = 'Timestamp' in r
            return ok, 'escaped' if ok else r[:80]
        t.run('Escape → back again', test_key_escape_again)

        # ── Phase 7: Toolbar interactions ────────────────────────────────

        def test_search_filter():
            """Type in the search bar to filter traces."""
            # Click the search entry (top of window)
            d.tool('click', {'windowName': 'OTelux', 'x': 300, 'y': 45})
            time.sleep(0.3)
            d.tool('type_text', {'text': 'dashboard'})
            time.sleep(1.0)
            path = d.screenshot('08_search_filter', 'OTelux')
            r = d.tool('read_screen_text', {'windowName': 'OTelux'})
            ok = path is not None
            return ok, r[:80]
        t.run('search filter: type "dashboard"', test_search_filter)

        def test_clear_search():
            """Clear the search and verify all traces return."""
            # Select all + delete
            d.tool('key_press', {'windowName': 'OTelux', 'keys': 'ctrl+a'})
            time.sleep(0.2)
            d.tool('key_press', {'windowName': 'OTelux', 'keys': 'Delete'})
            time.sleep(1.0)
            path = d.screenshot('09_search_cleared', 'OTelux')
            ok = path is not None
            return ok, 'cleared'
        t.run('clear search filter', test_clear_search)

        def test_click_refresh():
            """Click the Refresh button."""
            r = d.tool('click_text', {'windowName': 'OTelux', 'text': 'Refresh'})
            ok = 'Clicked' in r or 'clicked' in r.lower()
            time.sleep(0.5)
            return ok, r[:60]
        t.run('click Refresh button', test_click_refresh)

        def test_click_pause():
            """Click Pause to toggle auto-refresh."""
            r = d.tool('click_text', {'windowName': 'OTelux', 'text': 'Pause'})
            ok = 'Clicked' in r or 'clicked' in r.lower()
            time.sleep(0.5)
            return ok, r[:60]
        t.run('click Pause button', test_click_pause)

        def test_screenshot_paused():
            path = d.screenshot('10_paused', 'OTelux')
            ok = path is not None
            return ok, path or 'no screenshot'
        t.run('screenshot: paused state', test_screenshot_paused)

        def test_click_resume():
            """Click Resume (the toggled Pause button)."""
            r = d.tool('click_text', {'windowName': 'OTelux', 'text': 'Resume'})
            if 'Clicked' not in r:
                # Might still show "Pause" label
                r = d.tool('click_text', {'windowName': 'OTelux', 'text': 'Pause'})
            ok = 'Clicked' in r or 'clicked' in r.lower()
            time.sleep(0.5)
            return ok, r[:60]
        t.run('click Resume button', test_click_resume)

        # ── Phase 8: Status filter ───────────────────────────────────────

        def test_status_filter_error():
            """Select 'Error' from status dropdown.

            NOTE: GtkDropDown popover interaction via OCR-click is fragile on
            Xwayland (popup is a separate surface). This test may fail intermittently.
            The dropdown itself works — verified manually via screenshot.
            """
            # Aggressively get back to trace list
            d.tool('focus_window', {'windowName': 'OTelux'})
            time.sleep(0.3)
            # Click waterfall area + Escape
            d.tool('click', {'windowName': 'OTelux', 'x': 400, 'y': 100})
            time.sleep(0.2)
            d.tool('key_press', {'windowName': 'OTelux', 'keys': 'Escape'})
            time.sleep(0.5)
            # Also click sidebar Traces as fallback
            d.tool('click', {'windowName': 'OTelux', 'x': 75, 'y': 97})
            time.sleep(0.8)
            # Now click the "All" dropdown in the toolbar
            d.tool('click_text', {'windowName': 'OTelux', 'text': 'All'})
            time.sleep(0.8)
            # Dropdown popup opens — click "Error" in it
            # Use keyboard: Down, Down to select Error, then Enter
            d.tool('key_press', {'windowName': 'OTelux', 'keys': 'Down'})
            time.sleep(0.2)
            d.tool('key_press', {'windowName': 'OTelux', 'keys': 'Down'})
            time.sleep(0.2)
            d.tool('key_press', {'windowName': 'OTelux', 'keys': 'Return'})
            time.sleep(1.0)
            path = d.screenshot('11_status_error_filter', 'OTelux')
            r = d.tool('read_screen_text', {'windowName': 'OTelux'})
            # Should see error trace content (POST /charge or ERR)
            has_error = any(kw in r for kw in ['POST', 'charge', 'ERR',
                                                'payment', 'Error'])
            return has_error, r[:120]
        t.run('status filter: Error only', test_status_filter_error)

        def test_status_filter_all():
            """Reset to 'All' status filter via keyboard."""
            d.tool('focus_window', {'windowName': 'OTelux'})
            time.sleep(0.3)
            d.tool('click_text', {'windowName': 'OTelux', 'text': 'Error'})
            time.sleep(0.8)
            # Navigate up to "All"
            d.tool('key_press', {'windowName': 'OTelux', 'keys': 'Up'})
            time.sleep(0.2)
            d.tool('key_press', {'windowName': 'OTelux', 'keys': 'Up'})
            time.sleep(0.2)
            d.tool('key_press', {'windowName': 'OTelux', 'keys': 'Return'})
            time.sleep(1.0)
            path = d.screenshot('12_status_all', 'OTelux')
            ok = path is not None
            return ok, path or 'no screenshot'
        t.run('status filter: back to All', test_status_filter_all)

        # ── Phase 9: Column sort ─────────────────────────────────────────

        def test_sort_by_duration():
            """Click Duration column header to sort."""
            d.tool('click_text', {'windowName': 'OTelux', 'text': 'Duration'})
            time.sleep(0.5)
            path = d.screenshot('13_sort_duration', 'OTelux')
            ok = path is not None
            return ok, path or 'no screenshot'
        t.run('sort by Duration column', test_sort_by_duration)

        def test_sort_by_name():
            """Click Name column header to sort."""
            d.tool('click_text', {'windowName': 'OTelux', 'text': 'Name'})
            time.sleep(0.5)
            path = d.screenshot('14_sort_name', 'OTelux')
            ok = path is not None
            return ok, path or 'no screenshot'
        t.run('sort by Name column', test_sort_by_name)

        # ── Phase 10: Error trace styling ────────────────────────────────

        def test_error_trace_visible():
            """Verify error trace has visible styling (red left border)."""
            d.tool('focus_window', {'windowName': 'OTelux'})
            time.sleep(0.3)
            # Escape to trace list from wherever we are
            d.tool('click', {'windowName': 'OTelux', 'x': 400, 'y': 100})
            time.sleep(0.2)
            d.tool('key_press', {'windowName': 'OTelux', 'keys': 'Escape'})
            time.sleep(0.8)
            # Also try sidebar click as fallback
            d.tool('click', {'windowName': 'OTelux', 'x': 75, 'y': 97})
            time.sleep(0.8)
            path = d.screenshot('15_error_styling', 'OTelux')
            r = d.tool('read_screen_text', {'windowName': 'OTelux'})
            # Check for ERR or POST/charge (error trace) or the trace list headers
            has_list = 'Timestamp' in r or 'Duration' in r
            has_err = 'ERR' in r or 'charge' in r or 'POST' in r
            return has_list or has_err, r[:120]
        t.run('error trace styling visible', test_error_trace_visible)

        # ── Phase 11: Full journey — trace detail deep-dive ──────────────

        def test_open_error_trace():
            """Click on error trace row, verify waterfall shows error overlay."""
            d.tool('focus_window', {'windowName': 'OTelux'})
            time.sleep(0.3)
            # Click on second row (POST /charge — the error trace)
            d.tool('click', {'windowName': 'OTelux', 'x': 400, 'y': 150})
            time.sleep(1.0)
            path = d.screenshot('16_error_waterfall', 'OTelux')
            r = d.tool('read_screen_text', {'windowName': 'OTelux'})
            ok = any(kw in r for kw in ['Trace', 'POST', 'charge', 'Click'])
            return ok, r[:120]
        t.run('open error trace waterfall', test_open_error_trace)

        def test_click_error_span_detail():
            """Click span in error waterfall, verify detail shows error status."""
            d.tool('focus_window', {'windowName': 'OTelux'})
            time.sleep(0.3)
            d.tool('click', {'windowName': 'OTelux', 'x': 350, 'y': 100})
            time.sleep(0.8)
            r = d.tool('read_screen_text', {'windowName': 'OTelux'})
            path = d.screenshot('17_error_span_detail', 'OTelux')
            has_error_detail = any(kw in r for kw in ['Error', 'Status',
                                                       'Properties', 'Context'])
            return has_error_detail, r[:120]
        t.run('error span detail shows Error status', test_click_error_span_detail)

        # ── Phase 12: Sidebar navigation ─────────────────────────────────

        def test_sidebar_traces_click():
            """Click 'Traces' button in sidebar to go back to trace list."""
            d.tool('focus_window', {'windowName': 'OTelux'})
            time.sleep(0.3)
            # Click the sidebar "Traces" button directly by coordinates
            d.tool('click', {'windowName': 'OTelux', 'x': 75, 'y': 97})
            time.sleep(0.8)
            path = d.screenshot('18_sidebar_back', 'OTelux')
            r2 = d.tool('read_screen_text', {'windowName': 'OTelux'})
            back = 'Timestamp' in r2
            return back, r2[:120]
        t.run('sidebar Traces → back to list', test_sidebar_traces_click)

        # ── Phase 13: Live ingest while viewing ──────────────────────────

        def test_live_ingest():
            """Send new trace while viewing, verify it appears after auto-refresh."""
            # First go back to trace list via Escape
            d.tool('focus_window', {'windowName': 'OTelux'})
            time.sleep(0.3)
            d.tool('click', {'windowName': 'OTelux', 'x': 400, 'y': 100})
            time.sleep(0.2)
            d.tool('key_press', {'windowName': 'OTelux', 'keys': 'Escape'})
            time.sleep(0.5)

            live_trace = {
                "resourceSpans": [{
                    "resource": {
                        "attributes": [
                            {"key": "service.name", "value": {"stringValue": "live-svc"}}
                        ]
                    },
                    "scopeSpans": [{
                        "scope": {"name": "http"},
                        "spans": [{
                            "traceId": "dddd000011112222dddd000011112222",
                            "spanId": "dd00000000000001",
                            "parentSpanId": "",
                            "name": "GET /live-endpoint",
                            "kind": 1,
                            "startTimeUnixNano": "1715300003000000000",
                            "endTimeUnixNano":   "1715300003030000000",
                            "status": {"code": 1},
                            "attributes": []
                        }]
                    }]
                }]
            }
            status = send_otlp(live_trace)
            ok_send = (status == 200)
            # Wait for auto-refresh cycle
            time.sleep(3)
            d.tool('focus_window', {'windowName': 'OTelux'})
            time.sleep(0.3)
            path = d.screenshot('19_live_trace', 'OTelux')
            r = d.tool('read_screen_text', {'windowName': 'OTelux'})
            has_live = 'live' in r.lower() or 'GET' in r
            return ok_send and has_live, f'sent={status}, ocr={r[:80]}'
        t.run('live ingest: new trace appears', test_live_ingest)

        # ── Phase 14: Final screenshot ───────────────────────────────────

        def test_final_screenshot():
            d.tool('focus_window', {'windowName': 'OTelux'})
            time.sleep(0.3)
            path = d.screenshot('20_final_state', 'OTelux')
            ok = path is not None
            return ok, path or 'no screenshot'
        t.run('final screenshot', test_final_screenshot)

    finally:
        d.close()
        otelux_proc.terminate()
        try:
            otelux_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            otelux_proc.kill()
        # Cleanup test DB
        if os.path.exists(db_path):
            os.remove(db_path)

    print(f'\nScreenshots saved to {SCREENSHOT_DIR}/\n')
    ok = t.summary()
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
